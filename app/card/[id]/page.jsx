// app/card/[id]/page.jsx
"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

export default function CardDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const cardId = params?.id;
  const [currency, setCurrency] = useState(search.get("currency")?.toUpperCase() || "GBP");

  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState(null);
  const [series, setSeries] = useState([]);
  const [error, setError] = useState(null);

  const canvasRef = useRef(null);

  const fmt = (n) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n ?? 0);

  // Load & auto-log a point every 60s while open
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!cardId) return;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(
          `/api/track?cardId=${encodeURIComponent(cardId)}&currency=${currency}`,
          { cache: "no-store" }
        );
        const j = await r.json();
        if (cancelled) return;
        setCard(j?.card || null);
        setSeries(Array.isArray(j?.series) ? j.series : []);
      } catch (e) {
        if (!cancelled) setError(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [cardId, currency]);

  // Draw a lightweight line chart (no external deps)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const parent = canvas.parentElement;
    const w = Math.max(320, parent.clientWidth);
    const h = 300;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    // background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(0, 0, w, h);

    // no data
    if (!series || series.length === 0) {
      ctx.fillStyle = "#475569";
      ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("No points yet — they’ll appear automatically.", 12, 20);
      return;
    }

    // padding for axes
    const padL = 48, padR = 16, padT = 12, padB = 30;

    // compute domains
    const xs = series.map((p) => p.t);
    const ys = series.map((p) => p.price);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const yPad = (maxY - minY) * 0.08 || maxY * 0.08 || 1;
    const y0 = minY - yPad;
    const y1 = maxY + yPad;

    const xToPx = (x) => padL + ((x - minX) / (maxX - minX || 1)) * (w - padL - padR);
    const yToPx = (y) => padT + (1 - (y - y0) / (y1 - y0 || 1)) * (h - padT - padB);

    // grid
    ctx.strokeStyle = "rgba(148,163,184,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * (h - padT - padB);
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
    }
    ctx.stroke();

    // line
    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((p, i) => {
      const x = xToPx(p.t);
      const y = yToPx(p.price);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // axes labels
    ctx.fillStyle = "#334155";
    ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Arial";

    // y labels
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const vy = y0 + (i / yTicks) * (y1 - y0);
      const y = yToPx(vy);
      const text = fmt(vy);
      const metrics = ctx.measureText(text);
      ctx.fillText(text, padL - 6 - metrics.width, y + 3);
    }

    // x labels (first, mid, last)
    const tFirst = new Date(minX);
    const tLast = new Date(maxX);
    const tMid = new Date(minX + (maxX - minX) / 2);

    const fmtDate = (d) =>
      d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

    ctx.fillText(fmtDate(tFirst), padL, h - 8);
    ctx.fillText(fmtDate(tMid), (w - padL - padR) / 2 + padL - 14, h - 8);
    const lastText = fmtDate(tLast);
    const lastW = ctx.measureText(lastText).width;
    ctx.fillText(lastText, w - padR - lastW, h - 8);
  }, [series, currency]);

  // NM helpers
  const nmVariants = useMemo(() => {
    const expandCond = (abbr) => (abbr === "NM" ? "Near Mint" : abbr);
    const NM = "NM", NM_FULL = expandCond(NM);
    return (card?.variants || []).filter(
      (v) => v?.condition === NM || v?.condition === NM_FULL
    );
  }, [card]);

  const cheapest = useMemo(() => {
    let best = null;
    for (const v of nmVariants)
      if (typeof v.price === "number" && (!best || v.price < best.price)) best = v;
    return best;
  }, [nmVariants]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-100 to-sky-100 text-slate-900">
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40%_30%_at_20%_20%,rgba(99,102,241,0.25),transparent),radial-gradient(35%_25%_at_80%_10%,rgba(168,85,247,0.20),transparent),radial-gradient(30%_35%_at_50%_90%,rgba(56,189,248,0.18),transparent)]"></div>
        <div className="relative max-w-6xl mx-auto px-6 py-8">
          <header className="flex items-center gap-3">
            <a
              href="/hot"
              className="rounded-xl border border-white/40 bg-white/70 backdrop-blur px-3 py-1.5 text-sm hover:bg-white"
            >
              ← Hot Sellers
            </a>
            <div className="ml-auto flex items-center gap-3">
              <label className="text-xs font-semibold text-slate-700/80">Currency</label>
              <select
                className="rounded-xl border border-white/40 bg-white/70 px-3 py-2"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="GBP">GBP (£)</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>
          </header>

          {error && (
            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50/80 backdrop-blur text-red-800 p-3">
              <strong>Error:</strong> {error}
            </div>
          )}
          {loading && <div className="mt-6 text-slate-700">Loading…</div>}

          {card && (
            <div className="mt-6 grid gap-6 lg:grid-cols-[360px,1fr]">
              {/* Big image */}
              <div className="rounded-2xl border border-white/40 bg-white/70 backdrop-blur p-4">
                {card.imageLarge || card.image ? (
                  <img
                    src={card.imageLarge || card.image}
                    alt={`${card.name} large`}
                    className="w-full h-auto rounded-lg border border-white/50"
                  />
                ) : (
                  <div className="h-96 rounded-lg border border-white/50 bg-white/60 flex items-center justify-center text-slate-500">
                    No image
                  </div>
                )}
                <div className="mt-3">
                  <div className="text-lg font-black">{card.name}</div>
                  <div className="text-sm text-slate-600">
                    {card.set} · #{card.number} · {card.rarity || "—"}
                  </div>
                  <div className="mt-2 text-base">
                    Current (NM):{" "}
                    <strong>
                      {cheapest?.price != null ? fmt(cheapest.price) : "—"}
                    </strong>
                    {cheapest?.printing ? (
                      <span className="text-xs ml-2 px-2 py-0.5 rounded bg-indigo-50/70 border border-white/40">
                        {cheapest.printing}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Chart panel */}
              <div className="rounded-2xl border border-white/40 bg-white/70 backdrop-blur p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Near Mint price history</div>
                  <button
                    onClick={async () => {
                      if (cheapest?.price == null) return;
                      await fetch("/api/track", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          cardId,
                          currency,
                          price: cheapest.price,
                        }),
                      });
                      const r = await fetch(
                        `/api/track?cardId=${encodeURIComponent(cardId)}&currency=${currency}`,
                        { cache: "no-store" }
                      );
                      const j = await r.json();
                      setSeries(Array.isArray(j?.series) ? j.series : []);
                    }}
                    className="rounded-xl border border-white/40 bg-white/70 px-3 py-1.5 text-xs hover:bg-white"
                  >
                    Log current price
                  </button>
                </div>
                <div className="mt-3 h-72">
                  <canvas ref={canvasRef} />
                </div>
                {series.length === 0 && (
                  <div className="mt-3 text-xs text-slate-600">
                    No points yet — they’ll start appearing automatically while this
                    page is open (or click “Log current price”).
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
