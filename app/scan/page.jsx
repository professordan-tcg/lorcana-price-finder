"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";

// Lightweight fuzzy ranker for OCR -> card match
import Fuse from "fuse.js";

// NOTE: tesseract.js downloads worker & trained data in the browser.
// Keep this page client-only.
let Tesseract = null;

export default function ScanPage() {
  const [ready, setReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [currency, setCurrency] = useState("GBP"); // reuse your GBP toggle
  const [printing, setPrinting] = useState("");    // Normal / Foil (optional)
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState(null);

  const [match, setMatch] = useState(null);        // { card, price, fetchedAt }
  const [lastQuery, setLastQuery] = useState("");  // last OCR text
  const [confidence, setConfidence] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const loopRef = useRef(null);
  const cooldownRef = useRef(0);

  // ---------- helpers ----------
  const fmt = useCallback(
    (n) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n),
    [currency]
  );

  const expandCond = (abbr) => {
    const map = { NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged", S: "Sealed" };
    return map[abbr] || abbr;
  };
  const NM = "NM";
  const NM_FULL = expandCond(NM);

  function bestPriceNM(variants = []) {
    let vs = variants.filter((v) => v?.condition === NM_FULL || v?.condition === NM);
    if (printing) vs = vs.filter((v) => (v.printing || "").toLowerCase() === printing.toLowerCase());
    if (!vs.length) return null;
    let best = vs[0];
    for (const v of vs) {
      if (typeof v.price === "number" && (best.price == null || v.price < best.price)) best = v;
    }
    return best;
  }

  function normalize(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[^\w\s\-']/g, " ")     // strip funky chars
      .replace(/\s+/g, " ")
      .trim();
  }

  // ---------- init Tesseract (client side) ----------
  useEffect(() => {
    let mounted = true;
    (async () => {
      setStatus("Loading OCR engine…");
      try {
        const mod = await import("tesseract.js");
        if (!mounted) return;
        Tesseract = mod.default || mod;
        setReady(true);
        setStatus("OCR ready");
      } catch (e) {
        setError("Failed to load OCR. Check network and try again.");
        setStatus("Error");
      }
    })();
    return () => (mounted = false);
  }, []);

  // ---------- camera controls ----------
  const startCamera = useCallback(async () => {
    setError(null);
    setMatch(null);
    setStatus("Requesting camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment", // prefer back camera on phones
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus("Camera ready");
      }
    } catch (e) {
      setError("Could not access camera. Grant permission and use HTTPS.");
      setStatus("Error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    const v = videoRef.current;
    if (v && v.srcObject) {
      for (const t of v.srcObject.getTracks()) t.stop();
      v.srcObject = null;
    }
  }, []);

  // ---------- OCR loop ----------
  const runOnce = useCallback(async () => {
    if (!Tesseract || !videoRef.current || !canvasRef.current) return;

    // avoid hammering: 1 pass / 1200ms
    if (cooldownRef.current && Date.now() - cooldownRef.current < 1200) return;
    cooldownRef.current = Date.now();

    const v = videoRef.current;
    const c = canvasRef.current;
    const ctx = c.getContext("2d", { willReadFrequently: true });

    // Size canvas to a decent resolution for OCR (keep small to be fast)
    const W = 720;
    const H = Math.round((v.videoHeight / v.videoWidth) * W) || 480;
    c.width = W;
    c.height = H;

    // Draw current frame
    ctx.drawImage(v, 0, 0, W, H);

    // Crop the top band (card name area ~ top 18%); improve with a slider later
    const nameBandH = Math.round(H * 0.18);
    const nameBand = ctx.getImageData(0, 0, W, nameBandH);

    // Build a temp canvas for the crop (Tesseract likes an <img> or canvas)
    const crop = document.createElement("canvas");
    crop.width = W;
    crop.height = nameBandH;
    crop.getContext("2d").putImageData(nameBand, 0, 0);

    setStatus("Reading card text…");
    const { data } = await Tesseract.recognize(crop, "eng", {
      // logger: (m) => console.log(m), // uncomment for debugging
    });
    const text = normalize(data?.text || "");
    const words = (data?.words || []).filter((w) => (w?.text || "").trim().length > 0);
    const confAvg =
      words.length ? Math.round(words.reduce((s, w) => s + (w.confidence || 0), 0) / words.length) : null;

    setConfidence(confAvg);
    if (!text || text.length < 3) {
      setStatus("No text detected. Hold card steady with name near top edge.");
      return;
    }

    // Try to extract a plausible name line (first line, or the longest)
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const nameGuess = (lines[0] || lines.sort((a, b) => b.length - a.length)[0] || "").trim();

    if (!nameGuess) {
      setStatus("Reading…");
      return;
    }

    // Skip if same as last to reduce spam
    if (normalize(nameGuess) === normalize(lastQuery)) {
      setStatus(`Detected: “${nameGuess}” (${confAvg || "?"}%)`);
      return;
    }
    setLastQuery(nameGuess);
    setStatus(`Detected: “${nameGuess}” (${confAvg || "?"}%) — searching…`);

    // Query your own API (fast, cached) — NM only, images off for speed
    const qs = new URLSearchParams({
      q: nameGuess,
      limit: "12",
      currency,
      condition: "NM",
      images: "0",
    }).toString();

    const res = await fetch(`/api/cards?${qs}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(json?.data)) {
      setStatus("Search failed. Retrying…");
      return;
    }

    const candidates = json.data;

    // Fuzzy rank against API results (prefer exact/near name matches)
    const fuse = new Fuse(candidates, {
      includeScore: true,
      threshold: 0.35, // stricter is better for on-stream
      keys: [
        { name: "name", weight: 0.7 },
        { name: "set", weight: 0.2 },
        { name: "number", weight: 0.1 },
      ],
    });

    const ranked = fuse.search(nameGuess);
    const top = ranked[0]?.item || candidates[0];
    if (!top) {
      setStatus("No match found.");
      return;
    }

    // Fetch precise details via cardId (with images)
    const res2 = await fetch(
      `/api/cards?cardId=${encodeURIComponent(top.id)}&currency=${currency}&condition=NM`,
      { cache: "no-store" }
    );
    const json2 = await res2.json().catch(() => ({}));
    if (!res2.ok || !Array.isArray(json2?.data) || json2.data.length === 0) {
      setStatus("Matched, but failed to fetch details.");
      return;
    }

    const card = json2.data[0];
    const price = bestPriceNM(card.variants);
    setMatch({
      card,
      price,
      fetchedAt: Date.now(),
    });
    setStatus(`Matched: ${card.name}${price ? ` — ${fmt(price.price)}` : ""}`);
  }, [currency, printing, lastQuery]);

  const startLoop = useCallback(() => {
    if (loopRef.current) return;
    setScanning(true);
    setStatus("Starting scan…");
    loopRef.current = setInterval(runOnce, 400); // schedule tries; runOnce self-throttles
  }, [runOnce]);

  const stopLoop = useCallback(() => {
    setScanning(false);
    setStatus("Paused");
    if (loopRef.current) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopLoop();
      stopCamera();
    };
  }, [stopLoop, stopCamera]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight">Lorcana Live Scanner</h1>
        <p className="text-slate-600 mt-1">
          Hold a card with the <strong>name area</strong> near the top edge of the frame. We’ll OCR the name and show
          <strong> Near Mint</strong> prices instantly.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className="rounded-xl px-4 py-2 font-semibold shadow bg-slate-900 text-white hover:opacity-90 disabled:opacity-60"
            onClick={async () => {
              await startCamera();
              startLoop();
            }}
            disabled={!ready || scanning}
          >
            {ready ? (scanning ? "Scanning…" : "Start camera & scan") : "Loading OCR…"}
          </button>

          <button
            className="rounded-xl px-4 py-2 font-semibold border border-slate-300 bg-white hover:bg-slate-50"
            onClick={() => {
              stopLoop();
              stopCamera();
            }}
          >
            Stop
          </button>

          <select
            className="rounded-xl border border-slate-200 px-3 py-2"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            title="Currency"
          >
            <option value="GBP">GBP (£)</option>
            <option value="USD">USD ($)</option>
          </select>

          <select
            className="rounded-xl border border-slate-200 px-3 py-2"
            value={printing}
            onChange={(e) => setPrinting(e.target.value)}
            title="Printing"
          >
            <option value="">Any printing</option>
            <option value="Normal">Normal</option>
            <option value="Foil">Foil</option>
          </select>

          <span className="text-xs text-slate-500">Status: {status}{confidence != null ? ` · OCR ~${confidence}%` : ""}</span>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6 items-start">
          {/* Live video */}
          <div className="relative">
            <div className="aspect-video w-full overflow-hidden rounded-2xl border border-slate-200 bg-black">
              <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
            </div>

            {/* Visual guide for the top "name band" */}
            <div className="pointer-events-none absolute inset-0 flex flex-col">
              <div className="h-[18%] ring-2 ring-emerald-400/70 rounded-t-2xl" />
              <div className="flex-1 bg-transparent" />
            </div>

            {/* Hidden canvas used for OCR snapshots */}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Current match panel */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <div className="text-sm font-semibold">Current match</div>
            {!match && (
              <div className="text-slate-500 text-sm mt-2">
                No match yet. Keep the card steady, front-lit, and fill more of the frame.
              </div>
            )}

            {match && (
              <div className="mt-3 flex gap-3">
                {match.card.image && (
                  <img
                    src={match.card.image}
                    alt={`${match.card.name} image`}
                    className="w-40 h-auto rounded-lg border border-slate-200"
                  />
                )}
                <div className="flex-1">
                  <div className="text-base font-bold leading-tight">{match.card.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {match.card.set} · #{match.card.number} · {match.card.rarity || "—"}
                  </div>

                  <div className="mt-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Near Mint price</div>
                    <div className="text-2xl font-extrabold">
                      {match.price && typeof match.price.price === "number" ? fmt(match.price.price) : "—"}
                      {match.price?.printing ? (
                        <span className="ml-2 text-xs align-middle text-slate-500">({match.price.printing})</span>
                      ) : null}
                    </div>
                  </div>

                  {Array.isArray(match.card.variants) && match.card.variants.length > 0 && (
                    <div className="mt-3 overflow-hidden rounded-xl border border-slate-100">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="text-left px-3 py-2">Printing</th>
                            <th className="text-right px-3 py-2">Price (NM)</th>
                            <th className="text-right px-3 py-2">Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {match.card.variants
                            .filter((v) => v?.condition === NM || v?.condition === NM_FULL)
                            .filter((v) => !printing || (v.printing || "").toLowerCase() === printing.toLowerCase())
                            .map((v) => (
                              <tr key={v.id} className="odd:bg-white even:bg-slate-50/50">
                                <td className="px-3 py-2">{v.printing || "—"}</td>
                                <td className="px-3 py-2 text-right">
                                  {typeof v.price === "number" ? fmt(v.price) : "—"}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {v.lastUpdated ? new Date(v.lastUpdated * 1000).toLocaleDateString() : "—"}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tips */}
        <ul className="mt-6 text-sm text-slate-600 list-disc list-inside space-y-1">
          <li>For best results, keep the name bar well-lit and horizontal.</li>
          <li>Use a neutral, non-busy background behind the card.</li>
          <li>Phones: switch Safari/Chrome to “Request Desktop Site” if camera blocks OCR worker downloads.</li>
        </ul>
      </div>
    </main>
  );
}
