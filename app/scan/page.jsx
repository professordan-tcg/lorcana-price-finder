"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Fuse from "fuse.js";

// Load OpenCV.js at runtime (large lib, so we don’t bundle it)
const OPENCV_CDN = "https://docs.opencv.org/4.x/opencv.js";

// Globals for dynamic libs
let Tesseract = null;
let cv = null;

export default function ScanPage() {
  const [readyOCR, setReadyOCR] = useState(false);
  const [readyCV, setReadyCV] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [currency, setCurrency] = useState("GBP");
  const [printing, setPrinting] = useState("");
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState(null);

  const [match, setMatch] = useState(null);               // { card, price, fetchedAt }
  const [lastQuery, setLastQuery] = useState("");         // last OCR text string used
  const [confidence, setConfidence] = useState(null);     // avg OCR word confidence
  const [debug, setDebug] = useState(false);
  const [debugText, setDebugText] = useState("");
  const [debugCandidates, setDebugCandidates] = useState([]); // [{name, textScore, imgScore, final}]

  const videoRef = useRef(null);
  const sceneCanvasRef = useRef(null); // original downscaled frame for CV
  const ocrCanvasRef = useRef(null);   // preprocessed (binarized) image for OCR
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
  const normalize = (s) =>
    (s || "").toLowerCase().replace(/[^\w\s\-'/]/g, " ").replace(/\s+/g, " ").trim();

  const bestPriceNM = (variants = []) => {
    let vs = variants.filter((v) => v?.condition === NM_FULL || v?.condition === NM);
    if (printing) vs = vs.filter((v) => (v.printing || "").toLowerCase() === printing.toLowerCase());
    if (!vs.length) return null;
    let best = vs[0];
    for (const v of vs) {
      if (typeof v.price === "number" && (best.price == null || v.price < best.price)) best = v;
    }
    return best;
  };

  // ---------- dynamic loaders ----------
  useEffect(() => {
    let mounted = true;
    (async () => {
      setStatus("Loading OCR engine…");
      try {
        const mod = await import("tesseract.js");
        if (!mounted) return;
        Tesseract = mod.default || mod;
        setReadyOCR(true);
        setStatus("OCR ready");
      } catch (e) {
        setError("Failed to load OCR. Check network and try again.");
        setStatus("Error");
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setStatus((s) => (s.includes("Error") ? s : "Loading vision engine…"));
      if (window.cv) {
        cv = window.cv;
        if (mounted) setReadyCV(true);
        setStatus("Engines ready");
        return;
      }
      await loadScript(OPENCV_CDN);
      await waitFor(() => window.cv && window.cv.Mat); // wait for initialization
      cv = window.cv;
      if (!mounted) return;
      setReadyCV(true);
      setStatus("Engines ready");
    })().catch(() => {
      setError("Failed to load computer vision engine.");
      setStatus("Error");
    });
    return () => { mounted = false; };
  }, []);

  // ---------- camera ----------
  const startCamera = useCallback(async () => {
    setError(null);
    setMatch(null);
    setStatus("Requesting camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play();
        setStatus("Camera ready");
      }
    } catch (e) {
      setError("Could not access camera. Grant permission and use HTTPS.");
      setStatus("Error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    const v = videoRef.current;
    if (v?.srcObject) {
      for (const t of v.srcObject.getTracks()) t.stop();
      v.srcObject = null;
    }
  }, []);

  // ---------- main loop ----------
  const runOnce = useCallback(async () => {
    if (!Tesseract || !videoRef.current || !sceneCanvasRef.current) return;

    // limit to ~1 pass / 1.2s
    if (cooldownRef.current && Date.now() - cooldownRef.current < 1200) return;
    cooldownRef.current = Date.now();

    const v = videoRef.current;
    const scene = sceneCanvasRef.current;
    const ctx = scene.getContext("2d", { willReadFrequently: true });

    // Draw the frame (downscaled for perf)
    const W = 960;
    const H = Math.round((v.videoHeight / v.videoWidth) * W) || 540;
    scene.width = W; scene.height = H;
    ctx.drawImage(v, 0, 0, W, H);

    // Preprocess for OCR using OpenCV if available: gray -> blur -> adaptive threshold
    const ocrCanvas = ocrCanvasRef.current || scene;
    if (readyCV && cv && ocrCanvasRef.current) {
      try {
        const mat = cv.imread(scene);
        const gray = new cv.Mat();
        const bin = new cv.Mat();
        cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
        cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 15, 8);
        cv.imshow(ocrCanvas, bin);
        mat.delete(); gray.delete(); bin.delete();
      } catch {
        // Fall back to scene frame
      }
    }

    // 1) FULL-FRAME OCR
    setStatus("Reading card text…");
    const { data } = await Tesseract.recognize(ocrCanvas, "eng", {
      // You can try whitelisting typical chars to reduce noise:
      // tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-' 0123456789/–-",
      preserve_interword_spaces: "1",
    });

    const textFull = data?.text || "";
    if (debug) setDebugText(textFull);

    const words = (data?.words || []).filter((w) => (w?.text || "").trim().length > 0);
    const confAvg = words.length
      ? Math.round(words.reduce((s, w) => s + (w.confidence || 0), 0) / words.length)
      : null;
    setConfidence(confAvg);

    // Guess a name: longest line near the top third OR longest overall
    const lines = textFull.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const topThirdLimit = Math.max(Math.floor(lines.length * 0.33), 1);
    const longestTop = [...lines.slice(0, topThirdLimit)].sort((a, b) => b.length - a.length)[0] || "";
    const longestOverall = [...lines].sort((a, b) => b.length - a.length)[0] || "";
    const nameGuess = (longestTop.length >= 4 ? longestTop : longestOverall).trim();

    // Collector number like 123/204
    const numMatch = textFull.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
    const collectorNum = numMatch ? numMatch[1] : null;

    if (!nameGuess) {
      setStatus("No text yet… keep the card flat and well lit.");
      return;
    }
    if (normalize(nameGuess) === normalize(lastQuery)) {
      setStatus(`Detected: “${nameGuess}” (${confAvg || "?"}%)`);
      return;
    }
    setLastQuery(nameGuess);
    setStatus(`Detected: “${nameGuess}”${collectorNum ? ` #${collectorNum}` : ""} — searching…`);

    // 2) Call our API (Near Mint, images on for CV check)
    const qs = new URLSearchParams({
      q: nameGuess,
      limit: "20",
      currency,
      condition: "NM",
      images: "1",
    }).toString();
    const res = await fetch(`/api/cards?${qs}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(json?.data)) {
      setStatus("Search failed. Retrying…");
      return;
    }
    const candidates = json.data;

    // 3) TEXT rank (Fuse)
    const fuse = new Fuse(candidates, {
      includeScore: true,
      threshold: 0.38,
      keys: [
        { name: "name", weight: 0.75 },
        { name: "set", weight: 0.15 },
        { name: "number", weight: 0.10 },
      ],
    });
    const ranked = fuse.search(nameGuess).map((r) => ({
      item: r.item,
      textScore: 1 - (r.score ?? 1), // higher is better
      imgScore: 0,
      final: 0,
    }));
    // Boost by collector number match
    for (const r of ranked) {
      if (collectorNum && String(r.item.number).toLowerCase() === String(collectorNum).toLowerCase()) {
        r.textScore += 0.25;
      }
    }

    // Keep top N for CV
    const topN = ranked.sort((a, b) => b.textScore - a.textScore).slice(0, 8);

    // 4) IMAGE match (OpenCV ORB). If CORS blocks, this step yields 0 scores (still okay).
    let visionScored = [];
    if (readyCV && cv && v.readyState >= 2) {
      setStatus("Analyzing images…");
      const scenePrep = await prepareMatFromCanvas(scene);
      if (scenePrep) {
        const { gray: sceneGray, des: sceneDes, kp: sceneKp, orb, bf } = scenePrep;

        for (const r of topN) {
          const uri = r.item.image;
          if (!uri) { visionScored.push({ ...r }); continue; }
          try {
            const imgEl = await loadImage(uri);
            imgEl.crossOrigin = "anonymous";
            const candMat = cv.imread(imgEl);
            const candGray = new cv.Mat();
            cv.cvtColor(candMat, candGray, cv.COLOR_RGBA2GRAY);

            const kp = new cv.KeyPointVector();
            const des = new cv.Mat();
            orb.detect(candGray, kp);
            orb.compute(candGray, kp, des);

            const score = matchScoreORB(bf, sceneDes, des); // 0..1
            visionScored.push({ ...r, imgScore: score });

            kp.delete(); des.delete();
            candGray.delete(); candMat.delete();
          } catch {
            visionScored.push({ ...r }); // imgScore stays 0
          }
        }

        sceneKp.delete(); sceneDes.delete(); sceneGray.delete();
        orb.delete(); bf.delete();
      } else {
        visionScored = topN;
      }
    } else {
      visionScored = topN;
    }

    // 5) Combine scores
    const combined = visionScored
      .map((r) => ({ ...r, final: r.textScore * 0.7 + r.imgScore * 0.3 }))
      .sort((a, b) => b.final - a.final);

    if (debug) {
      setDebugCandidates(
        combined.slice(0, 5).map((r) => ({
          name: `${r.item.name} · ${r.item.set} #${r.item.number}`,
          textScore: +r.textScore.toFixed(3),
          imgScore: +r.imgScore.toFixed(3),
          final: +r.final.toFixed(3),
        }))
      );
    }

    const top = combined[0]?.item || candidates[0];
    if (!top) {
      setStatus("No match found.");
      return;
    }

    // 6) Fetch precise details via cardId (with images)
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
    setMatch({ card, price, fetchedAt: Date.now() });
    setStatus(
      `Matched: ${card.name}${collectorNum ? ` (#${collectorNum})` : ""}${price ? ` — ${fmt(price.price)}` : ""}`
    );
  }, [currency, printing, lastQuery, readyCV]);

  const startLoop = useCallback(() => {
    if (loopRef.current) return;
    setScanning(true);
    setStatus("Starting scan…");
    loopRef.current = setInterval(runOnce, 400);
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
    return () => { stopLoop(); stopCamera(); };
  }, [stopLoop, stopCamera]);

  // ---------- UI ----------
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight">Lorcana Live Scanner (Pro)</h1>
        <p className="text-slate-600 mt-1">
          Full-card OCR + collector-number + visual matching. Shows <strong>Near Mint</strong> prices.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className="rounded-xl px-4 py-2 font-semibold shadow bg-slate-900 text-white hover:opacity-90 disabled:opacity-60"
            onClick={async () => { await startCamera(); startLoop(); }}
            disabled={!readyOCR || !readyCV || scanning}
            title={!readyOCR ? "OCR loading…" : !readyCV ? "Vision engine loading…" : ""}
          >
            {readyOCR && readyCV ? (scanning ? "Scanning…" : "Start camera & scan") : "Loading engines…"}
          </button>

          <button
            className="rounded-xl px-4 py-2 font-semibold border border-slate-300 bg-white hover:bg-slate-50"
            onClick={() => { stopLoop(); stopCamera(); }}
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

          <label className="flex items-center gap-2 text-sm text-slate-700 ml-2">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
            Debug mode
          </label>

          <span className="text-xs text-slate-500">
            Status: {status}{confidence != null ? ` · OCR ~${confidence}%` : ""}{readyCV ? "" : " · (loading vision…)"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6 items-start">
          {/* Live video */}
          <div className="relative">
            <div className="aspect-video w-full overflow-hidden rounded-2xl border border-slate-200 bg-black">
              <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
            </div>

            {/* Hidden canvases */}
            <canvas ref={sceneCanvasRef} className="hidden" />
            <canvas ref={ocrCanvasRef} className={debug ? "mt-3 rounded-xl border border-slate-200 bg-white" : "hidden"} />

            {debug && (
              <div className="mt-3 bg-white rounded-xl border border-slate-200 p-3 text-xs text-slate-700">
                <div className="font-semibold mb-1">Last OCR text</div>
                <pre className="whitespace-pre-wrap break-words max-h-48 overflow-auto">{debugText}</pre>
              </div>
            )}
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

            {debug && debugCandidates.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-semibold mb-1">Top candidates</div>
                <ol className="text-xs text-slate-700 space-y-1 list-decimal list-inside">
                  {debugCandidates.map((c, i) => (
                    <li key={i}>
                      <div className="font-medium">{c.name}</div>
                      <div>text: {c.textScore} · img: {c.imgScore} · final: <strong>{c.final}</strong></div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>

        {/* Tips */}
        <ul className="mt-6 text-sm text-slate-600 list-disc list-inside space-y-1">
          <li>Good lighting and keeping the card flat hugely improves OCR & image match.</li>
          <li>If image scores stay 0, the image host may block CORS; text ranking will still work.</li>
          <li>To speed up, reduce frame width (search for <code>W = 960</code>) or increase the loop interval.</li>
        </ul>
      </div>
    </main>
  );
}

/* -------------------- helpers (outside component) -------------------- */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function waitFor(testFn, timeoutMs = 15000, intervalMs = 50) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const i = setInterval(() => {
      try {
        if (testFn()) { clearInterval(i); resolve(true); }
        else if (Date.now() - start > timeoutMs) { clearInterval(i); reject(new Error("waitFor timeout")); }
      } catch (e) { clearInterval(i); reject(e); }
    }, intervalMs);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function prepareMatFromCanvas(canvas) {
  try {
    const mat = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    // light downscale to reduce noise/features
    const graySmall = new cv.Mat();
    cv.resize(gray, graySmall, new cv.Size(0, 0), 0.75, 0.75, cv.INTER_AREA);

    const kp = new cv.KeyPointVector();
    const des = new cv.Mat();
    const orb = new cv.ORB(); // if this errors at runtime, switch to: const orb = new cv.ORB();
    const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);

    orb.detect(graySmall, kp);
    orb.compute(graySmall, kp, des);

    mat.delete(); gray.delete();
    return { gray: graySmall, kp, des, orb, bf };
  } catch {
    return null;
  }
}

function matchScoreORB(bf, desScene, desCand) {
  try {
    if (desScene.empty() || desCand.empty()) return 0;
    const matches = new cv.DMatchVectorVector();
    bf.knnMatch(desScene, desCand, matches, 2);

    // Lowe ratio
    let good = 0;
    for (let i = 0; i < matches.size(); i++) {
      const m = matches.get(i);
      if (m.size() >= 2) {
        const a = m.get(0), b = m.get(1);
        if (a.distance < 0.75 * b.distance) good++;
      }
      m.delete();
    }
    matches.delete();

    // normalize to 0..1 (120+ good matches ≈ very strong)
    return Math.min(good / 120, 1);
  } catch {
    return 0;
  }
}
