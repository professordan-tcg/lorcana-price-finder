// app/hot/page.jsx
"use client";
import React, { useEffect, useState } from "react";

export default function HotPage() {
  const [windowKey, setWindowKey] = useState("7d"); // "24h" | "7d"
  const [currency, setCurrency] = useState("GBP");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ source: "justtcg", message: "" });

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ window: windowKey, currency });
      const res = await fetch(`/api/hot?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      setItems(Array.isArray(json?.data) ? json.data : []);
      setMeta({ source: json?.source || "justtcg", message: json?.note || json?.message || "" });
    } catch (e) {
      setItems([]);
      setMeta({ source: "error", message: e?.message || "Failed to load" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60000); // refresh every 60s
    return () => clearInterval(id);
  }, [windowKey, currency]);

  function fmt(n) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  }
  function pct(n) {
    if (n == null) return "—";
    const s = n >= 0 ? "+" : "";
    return `${s}${n.toFixed(1)}%`;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-100 to-sky-100 text-slate-900">
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40%_30%_at_20%_20%,rgba(99,102,241,0.25),transparent),radial-gradient(35%_25%_at_80%_10%,rgba(168,85,247,0.20),transparent),radial-gradient(30%_35%_at_50%_90%,rgba(56,189,248,0.18),transparent)]"></div>

        <div className="relative max-w-6xl mx-auto px-6 py-8">
          <header className="flex items-center gap-3">
            <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-sky-600">
              🔥 Hot Selling Lorcana (JustTCG)
            </h1>
            <a
              href="/"
              className="ml-auto rounded-xl border border-white/40 bg-white/70 backdrop-blur px-3 py-1.5 text-sm hover:bg-white"
            >
              ← Back to Search
            </a>
          </header>
          <p className="mt-2 text-slate-700/90">
            Auto-updating momentum board based on JustTCG <em>Near Mint</em> price change.
            Choose a time window; prices shown in your selected currency.
          </p>

          {/* Controls */}
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-white/40 bg-white/60 backdrop-blur p-3">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-slate-700/80">Window</label>
              <select
                className="mt-1 rounded-xl border border-white/40 bg-white/70 px-3 py-2"
                value={windowKey}
                onChange={(e) => setWindowKey(e.target.value)}
              >
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
              </select>
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-slate-700/80">Currency</label>
              <select
                className="mt-1 rounded-xl border border-white/40 bg-white/70 px-3 py-2"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="GBP">GBP (£)</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>

            <button
              onClick={load}
              className="ml-auto rounded-2xl px-4 py-2 font-semibold shadow bg-gradient-to-r from-indigo-600 via-purple-600 to-sky-600 text-white hover:opacity-95 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div className="mt-3 text-xs text-slate-600">
            {meta.message ? <span>{meta.message}</span> : null}
          </div>

          {!loading && items.length === 0 && (
            <div className="mt-6 rounded-2xl border border-white/40 bg-white/70 backdrop-blur p-4">
              <div className="text-slate-700">
                No trending items found yet. Try switching the window or refresh.
              </div>
            </div>
          )}

          {/* Grid */}
          <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((it, idx) => (
              <li
                key={`${it.id || it.name}-${idx}`}
                className="rounded-2xl border border-white/40 bg-white/60 backdrop-blur p-4 shadow"
              >
                <div className="flex gap-3">
                  {it.image ? (
                    <img
                      src={it.image}
                      alt={`${it.name} image`}
                      className="w-20 h-auto rounded border border-white/40"
                    />
                  ) : (
                    <div className="w-20 h-28 rounded border border-white/40 bg-white/50 flex items-center justify-center text-xs text-slate-500">
                      No image
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{it.name}</div>
                    <div className="text-xs text-slate-600 truncate">
                      {(it.set || "—")} {it.number ? `· #${it.number}` : ""}
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-xs">
                        Trend ({it.trendWindow}):{" "}
                        <span
                          className={
                            (it.trendPct ?? 0) >= 0
                              ? "font-bold text-emerald-700"
                              : "font-bold text-rose-700"
                          }
                        >
                          {pct(it.trendPct)}
                        </span>
                      </div>
                      <div className="text-sm font-extrabold">
                        {it.livePrice != null ? fmt(it.livePrice) : "—"}
                      </div>
                    </div>

                    <div className="mt-2 flex gap-2">
                      <a
                        className="rounded-lg border border-white/40 bg-white/70 px-2 py-1 text-xs hover:bg-white"
                        href={`/?q=${encodeURIComponent(it.name)}`}
                        title="Open in search"
                      >
                        Open in Search
                      </a>
                      {it.printing ? (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-50/70 border border-white/40">
                          {it.printing}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
