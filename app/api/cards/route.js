import { NextResponse } from "next/server";

const API_BASE = "https://api.justtcg.com/v1/cards";
const LORCAST_SEARCH = "https://api.lorcast.com/v0/cards/search"; // images source

// USD → GBP using env var rate (e.g., 0.78 means $1 = £0.78)
function usdToGbp(usd) {
  const rate = Number(process.env.JUSTTCG_GBP_PER_USD || "");
  if (!rate || !isFinite(rate)) return usd;
  return usd * rate;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Find a good Lorcast image for a JustTCG card row
async function fetchLorcastImageFor(card) {
  try {
    const params = new URLSearchParams({ q: card.name, unique: "prints" });
    const res = await fetch(`${LORCAST_SEARCH}?${params.toString()}`, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const results = json?.results || [];

    const norm = (s) => (s || "").toLowerCase().replace(/[–—−-]/g, "-").replace(/[^a-z0-9]+/g, " ").trim();

    // Prefer exact set+number match, then number, then set, else first
    let cand = results.find(r =>
      (card.number ? String(r.collector_number).toLowerCase() === String(card.number).toLowerCase() : true) &&
      norm(r.set?.name) === norm(card.set)
    );
    if (!cand && card.number) cand = results.find(r => String(r.collector_number).toLowerCase() === String(card.number).toLowerCase());
    if (!cand) cand = results.find(r => norm(r.set?.name) === norm(card.set));
    if (!cand && results.length) cand = results[0];

    // Lorcast provides image_uris.digital.{small|normal|large}
    return cand?.image_uris?.digital?.normal || cand?.image_uris?.digital?.small || null;
  } catch {
    return null;
  }
}

export async function GET(request) {
  const apiKey = process.env.JUSTTCG_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server missing JUSTTCG_API_KEY" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);

  // Build pass-through query to JustTCG
  const params = new URLSearchParams();
  const q = searchParams.get("q") ?? "";
  if (q) params.set("q", q);
  params.set("game", "disney-lorcana");

  const condition = searchParams.get("condition") ?? "";
  const printing  = searchParams.get("printing")  ?? "";
  const limit     = searchParams.get("limit")     ?? "20";
  const currency  = (searchParams.get("currency") || "USD").toUpperCase(); // USD|GBP
  const withImages = (searchParams.get("images") ?? "1") !== "0"; // images=0 to skip
  const cardId    = searchParams.get("cardId"); // optional precise fetch

  if (condition) params.set("condition", condition);
  if (printing)  params.set("printing",  printing);
  if (limit)     params.set("limit",     limit);
  if (cardId)    params.set("cardId",    cardId);

  try {
    const upstream = await fetch(`${API_BASE}?${params.toString()}`, {
      headers: { "x-api-key": apiKey },
      next: { revalidate: 30 },
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = data?.error || data?.message || "JustTCG request failed";
      return NextResponse.json({ error: message }, { status: upstream.status });
    }

    if (!Array.isArray(data?.data)) {
      return NextResponse.json({ ...data, currency }, { status: 200 });
    }

    // GBP conversion
    if (currency === "GBP") {
      for (const card of data.data) {
        if (Array.isArray(card.variants)) {
          for (const v of card.variants) {
            if (typeof v.price === "number") v.price = usdToGbp(v.price);
          }
        }
      }
    }

    // Image enrichment (limit to first 12 for speed)
    if (withImages) {
      const slice = data.data.slice(0, 12);
      for (let i = 0; i < slice.length; i++) {
        const uri = await fetchLorcastImageFor(slice[i]);
        if (uri) slice[i].image = uri;
        await sleep(60); // gentle pacing
      }
    }

    return NextResponse.json({ ...data, currency }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Server error contacting JustTCG" }, { status: 502 });
  }
}
