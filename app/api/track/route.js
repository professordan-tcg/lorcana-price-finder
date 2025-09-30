// app/api/track/route.js
import { NextResponse } from "next/server";

// --- KV via REST (no @vercel/kv SDK) ---
const KV_URL = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

const kvAvailable = () => !!KV_URL && !!KV_TOKEN;

async function kvGet(key) {
  if (!kvAvailable()) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      cache: "no-store",
    });
    const j = await res.json();
    if (j && typeof j.result === "string") {
      return JSON.parse(j.result);
    }
    return null;
  } catch {
    return null;
  }
}

async function kvSet(key, value) {
  if (!kvAvailable()) return false;
  try {
    const val = encodeURIComponent(JSON.stringify(value));
    const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${val}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const cardId = searchParams.get("cardId");
  const currency = (searchParams.get("currency") || "GBP").toUpperCase();
  const origin = new URL(req.url).origin;

  if (!cardId) return NextResponse.json({ error: "Missing cardId" }, { status: 400 });

  let series = [];
  if (kvAvailable()) {
    series = (await kvGet(`ts:${currency}:${cardId}`)) || [];
    if (!Array.isArray(series)) series = [];
    series.sort((a, b) => a.t - b.t);
  }

  // Fetch current price (cheapest NM) via your proxy
  let card = null,
    priceNow = null;
  try {
    const r = await fetch(
      `${origin}/api/cards?cardId=${encodeURIComponent(
        cardId
      )}&condition=NM&images=1&currency=${currency}`,
      { cache: "no-store" }
    );
    const j = await r.json();
    card = Array.isArray(j?.data) ? j.data[0] : null;
    if (card) {
      const nm = (card.variants || []).filter(
        (v) => v?.condition === "Near Mint" || v?.condition === "NM"
      );
      let best = null;
      for (const v of nm)
        if (typeof v.price === "number" && (!best || v.price < best.price)) best = v;
      priceNow = best?.price ?? null;
    }
  } catch {}

  // Append a point (dedupe if last <6h old or same price)
  if (kvAvailable()) {
    const now = Date.now();
    const SIX_H = 6 * 60 * 60 * 1000;
    const last = series[series.length - 1];
    if (priceNow != null && (!last || now - last.t > SIX_H || last.price !== priceNow)) {
      series.push({ t: now, price: priceNow });
      if (series.length > 400) series = series.slice(series.length - 400);
      await kvSet(`ts:${currency}:${cardId}`, series);
    }
  }

  return NextResponse.json(
    { series, card, note: kvAvailable() ? undefined : "KV not configured; series won’t persist." },
    { status: 200 }
  );
}

export async function POST(req) {
  if (!kvAvailable()) {
    return NextResponse.json(
      { ok: false, error: "KV not configured on server" },
      { status: 501 }
    );
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }
  const cardId = body?.cardId;
  const currency = (body?.currency || "GBP").toUpperCase();
  const price = Number(body?.price);
  if (!cardId || !Number.isFinite(price))
    return NextResponse.json({ ok: false, error: "Missing cardId/price" }, { status: 400 });

  const key = `ts:${currency}:${cardId}`;
  let series = (await kvGet(key)) || [];
  if (!Array.isArray(series)) series = [];
  series.push({ t: Date.now(), price });
  series.sort((a, b) => a.t - b.t);
  if (series.length > 400) series = series.slice(series.length - 400);
  await kvSet(key, series);
  return NextResponse.json({ ok: true }, { status: 200 });
}
