"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Fuse from "fuse.js";

// Load OpenCV.js at runtime (no install)
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

  const [match, setMatch] = useState(null);
  const [lastQuery, setLastQuery] = useState("");
  const [confidence, setConfidence] = useState(null);

  // Debug UI
  const [debug, setDebug] = useState(false);
  const [debugText, setDebugText] = useState("");
  const [debugCandidates, setDebugCandidates] = useState([]);

  // Name-focus ROI (percent-of-frame sliders)
  const [roiTopPct, setRoiTopPct] = useState(10);
  const [roiHeightPct, setRoiHeightPct] = useState(18);
  const [roiLeftPct, setRoiLeftPct] = useState(5);
  const [roiWidthPct, setRoiWidthPct] = useState(90);
  const [nameFocus, setNameFocus] = useState(true); // scan only inside the box first

  const videoRef = useRef(null);
  const sceneCanvasRef = useRef(null); // downscaled full frame (for CV & fallback OCR)
  const roiCanvasRef = useRef(null);   // binarized ROI image (for OCR)
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
      } catch {
        setError("Failed to load OCR.");
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
      await waitFor(() => window.cv && window.cv.Mat);
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
    } catch {
      setError("Could not access camera. Use HTTPS and allow permission.");
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

  // ---------- preprocessing for white name text ----------
  function preprocessNameROI(sceneCanvas, rx, ry, rw, rh) {
    // Returns a binarized <canvas> (white background, black text) for OCR
    // Pipeline: crop -> HSV -> white-ish mask (low S + high V) -> CLAHE on L -> adaptive threshold -> invert to black text
    try {
      const out = roiCanvasRef.current;
      if (!readyCV || !cv || !out) return null;

      const full = cv.imread(sceneCanvas);
      const rect = new cv.Rect(rx, ry, rw, rh);
      const roi = full.roi(rect);

      const hsv = new cv.Mat();
      cv.cvtColor(roi, hsv, cv.COLOR_RGBA2HSV);

      const channels = new cv.MatVector();
      cv.split(hsv, channels);
      const H = channels.get(0), S = channels.get(1), V = channels.get(2);

      // Threshold for white-ish: low saturation, high value
      const sMask = new cv.Mat();
      const vMask = new cv.Mat();
      cv.threshold(S, sMask, 60, 255, cv.THRESH_BINARY_INV); // S < 60
      cv.threshold(V, vMask, 200, 255, cv.THRESH_BINARY);    // V > 200
      const whiteMask = new cv.Mat();
      cv.bitwise_and(sMask, vMask, whiteMask);

      // Enhance contrast on lightness
      const lab = new cv.Mat();
      cv.cvtColor(roi, lab, cv.COLOR_RGBA2Lab);
      const labCh = new cv.MatVector();
      cv.split(lab, labCh);
      const L = labCh.get(0);
      const clahe = new cv.CLAHE(3.0, new cv.Size(8, 8));
      const L2 = new cv.Mat();
      clahe.apply(L, L2);

      // combine: keep bright low-sat regions from L2
      const Lmask = new cv.Mat();
      cv.bitwise_and(L2, whiteMask, Lmask);

      // Clean up + threshold + invert (black text on white)
      const blur = new cv.Mat();
      cv.GaussianBlur(Lmask, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
      const bin = new cv.Mat();
      cv.adaptiveThreshold(blur, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 15, 10);

      const inv = new cv.Mat();
      cv.bitwise_not(bin, inv);

      // mild morphology to thicken strokes
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
      const thick = new cv.Mat();
      cv.morphologyEx(inv, thick, cv.MORPH_CLOSE, kernel);

      // show into ROI canvas (sized to ROI)
      out.width = rw;
      out.height = rh;
      cv.imshow(out, thick);

      // cleanup
      full.delete(); roi.delete(); hsv.delete();
      channels.delete(); H.delete(); S.delete(); V.delete();
      sMask.delete(); vMask.delete(); whiteMask.delete();
      lab.delete(); labCh.delete(); L.delete(); L2.delete();
      Lmask.delete(); blur.delete(); bin.delete(); inv.delete(); kernel.delete(); thick.delete();

      return out;
    } catch {
      return null;
    }
  }

  // ---------- main loop ----------
  const runOnce = useCallback(async () => {
    if (!Tesseract || !videoRef.current || !sceneCanvasRef.current) return;

    // throttle passes
    if (cooldownRef.current && Date.now() - cooldownRef.current < 1000) return;
    cooldownRef.current = Date.now();

    const v = videoRef.current;
    const scene = sceneCanvasRef.current;
    const ctx = scene.getContext("2d", { willReadFrequently: true });

    // Draw frame (downscaled)
    const W = 960;
    const H = Math.round((v.videoHeight / v.videoWidth) * W) || 540;
    scene.width = W; scene.height = H;
    ctx.drawImage(v, 0, 0, W, H);

    // Compute ROI rect in pixels
    const rx = Math.max(0, Math.round((roiLeftPct / 100) * W));
    const ry = Math.max(0, Math.round((roiTopPct / 100) * H));
    const rw = Math.max(1, Math.round((roiWidthPct / 100) * W));
    const rh = Math.max(1, Math.round((roiHeightPct / 100) * H));

    // 1) NAME-FOCUS OCR first
    let nameGuess = "";
    let confAvg = null;

    if (nameFocus) {
      const roiCanvas = preprocessNameROI(scene, rx, ry, rw, rh) || scene; // fall back to scene if preprocess fails
      setStatus("Reading name in scan box…");
      const { data } = await Tesseract.recognize(roiCanvas, "eng", {
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-' 0123456789/:.–",
        preserve_interword_spaces: "1",
      });
      const textBox = data?.text || "";
      if (debug) setDebugText(textBox);

      const words = (data?.words || []).filter((w) => (w?.text || "").trim().length > 0);
      confAvg = words.length
        ? Math.round(words.reduce((s, w) => s + (w.confidence || 0), 0) / words.length)
        : null;
      // Prefer first non-empty line (title usually first)
      nameGuess = (textBox.split(/\n+/).map((l) => l.trim()).find(Boolean) || "").trim();
    }

    // 2) Fallback to FULL-FRAME OCR if box didn’t produce something useful
    let collectorNum = null;
    if (!nameGuess || nameGuess.length < 3) {
      setStatus("Reading full card text…");
      const { data } = await Tesseract.recognize(scene, "eng", { preserve_interword_spaces: "1" });
      const textFull = data?.text || "";
      if (debug && !nameFocus) setDebugText(textFull);

      const words = (data?.words || []).filter((w) => (w?.text || "").trim().length > 0);
      confAvg = words.length
        ? Math.round(words.reduce((s, w) => s + (w.confidence || 0), 0) / words.length)
        : confAvg;

      const lines = textFull.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const topThirdLimit = Math.max(Math.floor(lines.length * 0.33), 1);
      const longestTop = [...lines.slice(0, topThirdLimit)].sort((a, b) => b.length - a.length)[0] || "";
      const longestOverall = [...lines].sort((a, b) => b.length - a.length)[0] || "";
      nameGuess = (longestTop.length >= 4 ? longestTop : longestOverall).trim();

      const numMatch = textFull.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
      collectorNum = numMatch ? numMatch[1] : null;
    } else {
      // If we have a good name from ROI, do a lightweight collector-number OCR on lower third
      const lowerH = Math.round(H * 0.28);
      const lowerY = Math.max(0, H - lowerH);
      try {
        const mat = cv.imread(scene);
        const roi = mat.roi(new cv.Rect(0, lowerY, W, lowerH));
        const gray = new cv.Mat();
        cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
        const bin = new cv.Mat();
        cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 15, 10);
        const tmp = document.createElement("canvas");
        tmp.width = W; tmp.height = lowerH;
        cv.imshow(tmp, bin);
        const o = await Tesseract.recognize(tmp, "eng", { tessedit_char_whitelist: "0123456789/" });
        const m = (o?.data?.text || "").match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
        collectorNum = m ? m[1] : null;
        roi.delete(); gray.delete(); bin.delete(); mat.delete();
      } catch {
        /* ignore */
      }
    }

    if (!nameGuess) {
      setStatus("No text yet… adjust the scan box to the card title and add more light.");
      return;
    }
    if (normalize(nameGuess) === normalize(lastQuery)) {
      setStatus(`Detected: “${nameGuess}” (${confAvg || "?"}%)`);
      return;
    }
    setLastQuery(nameGuess);
    setStatus(`Detected: “${nameGuess}”${collectorNum ? ` #${collectorNum}` : ""} — searching…`);

    // 3) Call our API (NM, with images for optional CV)
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

    // 4) Text rank (Fuse) + number boost
    const fuse = new Fuse(candidates, {
      includeScore: true,
      threshold: 0.34, // tighter now that OCR is cleaner
      keys: [
        { name: "name", weight: 0.8 },
        { name: "set", weight: 0.15 },
        { name: "number", weight: 0.05 },
      ],
    });
    const ranked = fuse.search(nameGuess).map((r) => ({
      item: r.item,
      textScore: 1 - (r.score ?? 1),
      imgScore: 0,
      final: 0,
    }));
    for (const r of ranked) {
      if (collectorNum && String(r.item.number).toLowerCase() === String(collectorNum).toLowerCase()) {
        r.textScore += 0.3; // stronger boost when number matches
      }
    }
    const topN = ranked.sort((a, b) => b.textScore - a.textScore).slice(0, 6);

    // 5) Optional: image match (kept, but ROI usually makes text enough)
    let combined = topN;
    if (readyCV && cv && videoRef.current.readyState >= 2) {
      const scenePrep = await prepareMatFromCanvas(scene);
      if (scenePrep) {
        const { gray: sceneGray, des: sceneDes, kp: sceneKp, orb, bf } = scenePrep;
        const scored = [];
        for (const r of topN) {
          const uri = r.item.image;
          if (!uri) { scored.push(r); continue; }
          try {
            const imgEl = await loadImage(uri);
            imgEl.crossOrigin = "anonymous";
            const candMat = cv.imread(imgEl

