"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Fuse from "fuse.js";

// Load OpenCV.js in the browser
const OPENCV_CDN = "https://docs.opencv.org/4.x/opencv.js";
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
  const [debug, setDebug] = useState(true);       // show top candidates + OCR text
  const [useVision, setUseVision] = useState(true);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const loopRef = useRef(null);
  const cooldownRef = useRef(0);

  const [debugText, setDebugText] = useState("");
  const [debugCandidates, setDebugCandidates] = useState([]);

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
  const normalize = (s) => (s || "").toLowerCase().replace(/[^\w\s\-'/]/g, " ").replace(/\s+/g, " ").trim();

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
      const mod = await import("tesseract.js");
      if (!mounted) return;
      Tesseract = mod.default || mod;
      setReadyOCR(true);
      setStatus("OCR ready");
    })().catch(() => {
      setError("Failed to load OCR.");
      setStatus("Error");
    });
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
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus("Camera ready");
      }
    } catch {
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

  // ---------- scanner loop ----------
  const runOnce = useCallback(async () => {
    if (!Tesseract || !videoRef.current || !canvasRef.current) return;
    if (cooldownRef.current && Date.now() - cooldownRef.current < 1000) return; // throttle ~1/s
    cooldownRef.current = Date.now();

    const v = videoRef.current;
    const scene = canvasRef.current;
    const ctx = scene.getContext("2d", { willReadFrequently: true });

    // Draw current frame (downscale a bit for speed)
    const W = 1280;
    const H = Math.round((v.videoHeight / v.videoWidth) * W) || 720;
    scene.width = W; scene.height = H;
    ctx.drawImage(v, 0, 0, W, H);

    // Try to detect card & warp to a flat view for better OCR & matching
    let warpCanvas = document.createElement("canvas");
    try {
      const warped = detectAndWarpCardFromCanvas(scene); // cv-based
      if (warped) {
        warpCanvas = warped;
      } else {
        // fallback: use scene as-is
        warpCanvas = scene;
      }
    } catch {
      warpCanvas = scene;
    }

    // Light preprocessing for OCR: convert to grayscale & increase contrast
    const prepCanvas = preprocessForOCR(warpCanvas);

    setStatus("Reading card text…");
    const { data } = await Tesseract.recognize(prepCanvas, "eng", { psm: 6 }); // block of text
    const textFull = data?.text || "";
    setDebugText(textFull);

    const words = (data?.words || []).filter((w) => (w?.text || "").trim().length > 0);
    const confAvg = words.length ? Math.round(words.reduce((s, w) => s +
