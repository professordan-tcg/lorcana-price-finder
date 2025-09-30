// app/api/track/route.js
import { NextResponse } from "next/server";

let kv = null;
try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const mod = await import("@vercel/kv");
    kv = mod.kv;
  }
} catch {}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const cardId = searchParams.get("cardId");
  const currency = (searchParams.get("currency") || "GBP").toUpperCase();
  const origin = new URL(req.url).origin;

  if (!cardId) return NextResponse.json({ error: "Missing cardId" }, { status: 400 });
  if (!kv) return NextResponse.json({ series: [], card: null, note: "KV not configured" }, { status: 200 });

  const key = `ts:${currency}:${cardId}`;

  // Load existing series
  let series = (await kv.get(key)) || [];
  if (!Array.isArray(series)) series = [];
  series.sort((a,b) => a.t - b.t);

  // Fetch current price (cheapest NM) via your proxy
  let card = null, priceNow = null;
  try {
    const r = await fetch(`${origin}/api/cards?cardId=${encodeURIComponent(cardId)}&condition=NM&images=1&currency=${currency}`, { cache: "no-store" });
    const j = await r.json();
    card = Array.isArray(j?.data) ? j.data[0] : null;
    if (card) {
      const nm = (card.variants || []).filter(v => v?.condition === "Near Mint" || v?.condition === "NM");
      let best = null;
      for (const v of nm) if (typeof v.price === "number" && (!best || v.price < best.price)) best = v;
      priceNow = best?.price ?? null;
    }
  } catch {}

  // Upsert today's point (avoid spam: if last point < 6h old, skip)
  const now = Date.now();
  const SIX_H = 6 * 60 * 60 * 1000;
  const last = series[series.length - 1];
  if (priceNow != null && (!last || now - last.t > SIX_H || last.price !== priceNow)) {
    series.push({ t: now, price: priceNow });
    if (series.length > 400) series = series.slice(series.length - 400); // cap
    await kv.set(key, series);
  }

  return NextResponse.json({ series, card }, { status: 200 });
}

export async function POST(req) {
  if (!kv) return NextResponse.json({ ok: false, error: "KV not configured" }, { status: 501 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 }); }
  const cardId = body?.cardId;
  const currency = (body?.currency || "GBP").toUpperCase();
  const price = Number(body?.price);
  if (!cardId || !Number.isFinite(price)) return NextResponse.json({ ok: false, error: "Missing cardId/price" }, { status: 400 });

  const key = `ts:${currency}:${cardId}`;
  let series = (await kv.get(key)) || [];
  if (!Array.isArray(series)) series = [];
  series.push({ t: Date.now(), price });
  series.sort((a,b) => a.t - b.t);
  if (series.length > 400) series = series.slice(series.length - 400);
  await kv.set(key, series);
  return NextResponse.json({ ok: true }, { status: 200 });
}
