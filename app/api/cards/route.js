import { NextResponse } from "next/server";

const JUSTTCG_CARDS = "https://api.justtcg.com/v1/cards";
const LORCAST_SEARCH = "https://api.lorcast.com/v0/cards/search"; // 1st image source
const LORCANA_API    = "https://api.lorcana-api.com/cards/fetch"; // 2nd image source
// 3rd image source (community data files). Exact paths can change, so we try a few:
const LORCANAJSON_CANDIDATES = [
  // Common patterns seen in the wild; we'll try them in order and ignore failures.
  "https://lorcanajson.org/data/en/cards.json",
  "https://lorcanajson.org/data/english/cards.json",
  "https://lorcanajson.org/en/cards.json",
  "https://lorcanajson.org/cards-en.json",
];

// USD → GBP via env var, e.g. JUSTTCG_GBP_PER_USD=0.78
function usdToGbp(usd) {
  const rate = Number(process.env.JUSTTCG_GBP_PER_USD || "");
  if (!rate || !isFinite(rate)) return usd; // fallback: keep USD
  return usd * rate;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** normalize helper for loose matching */
function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[–—−-]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** 1) Try Lorcast for an image (fast & reliable when available) */
async function fetchLorcastImageFor(card) {
  try {
    const params = new URLSearchParams({ q: card.name, unique: "prints" });
    const res = await fetch(`${LORCAST_SEARCH}?${params.toString()}`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const results = json?.results || [];
    if (!results.length) return null;

    // Prefer same set+number, then number, then set, else first
    let cand = results.find(
      (r) =>
        (!card.number ||
          String(r.collector_number).toLowerCase() ===
            String(card.number).toLowerCase()) &&
        norm(r.set?.name) === norm(card.set)
    );
    if (!cand && card.number) {
      cand = results.find(
        (r) =>
          String(r.collector_number).toLowerCase() ===
          String(card.number).toLowerCase()
      );
    }
    if (!cand) cand = results.find((r) => norm(r.set?.name) === norm(card.set));
    if (!cand) cand = results[0];

    // Lorcast: image_uris.digital.{small|normal|large}
    return (
      cand?.image_uris?.digital?.normal ||
      cand?.image_uris?.digital?.small ||
      null
    );
  } catch {
    return null;
  }
}

/** 2) Fallback: Lorcana-api.com (returns an Image URL per card) */
async function fetchLorcanaApiImageFor(card) {
  try {
    const tryStrict = async () => {
      const p = new URLSearchParams({
        strict: card.name, // e.g. "Elsa - Spirit of Winter"
        pagesize: "10",
        displayonly: "Name,Image,Set_Name,Set_ID",
      });
      const r = await fetch(`${LORCANA_API}?${p.toString()}`, {
        next: { revalidate: 86400 },
      });
      if (!r.ok) return [];
      const arr = await r.json().catch(() => []);
      return Array.isArray(arr) ? arr : [];
    };

    const trySearch = async () => {
      const p = new URLSearchParams({
        search: `name~${card.name}`,
        pagesize: "10",
        displayonly: "Name,Image,Set_Name,Set_ID",
      });
      const r = await fetch(`${LORCANA_API}?${p.toString()}`, {
        next: { revalidate: 86400 },
      });
      if (!r.ok) return [];
      const arr = await r.json().catch(() => []);
      return Array.isArray(arr) ? arr : [];
    };

    let hits = await tryStrict();
    if (!hits.length) hits = await trySearch();
    if (!hits.length) return null;

    let cand =
      hits.find((h) => norm(h.Set_Name || h.set_name) === norm(card.set)) ||
      hits[0];

    const img = cand.Image || cand.image || null;
    return img || null;
  } catch {
    return null;
  }
}

/** 3) Fallback: LorcanaJSON data files (community dataset) */
let lorcanaJsonCache = null; // memoize across requests within lambda
async function fetchLorcanaJsonDataset() {
  if (lorcanaJsonCache) return lorcanaJsonCache;

  for (const url of LORCANAJSON_CANDIDATES) {
    try {
      const r = await fetch(url, { next: { revalidate: 86400 } });
      if (!r.ok) continue;
      const data = await r.json().catch(() => null);
      if (data && (Array.isArray(data) || Array.isArray(data?.cards))) {
        lorcanaJsonCache = Array.isArray(data) ? data : data.cards;
        return lorcanaJsonCache;
      }
    } catch {
      // try next candidate
    }
  }
  lorcanaJsonCache = [];
  return lorcanaJsonCache;
}

function pickAnyImageField(obj) {
  // Try common field names used across fan datasets
  return (
    obj?.imageUrl ||
    obj?.imageURL ||
    obj?.image ||
    obj?.cardImage ||
    obj?.assets?.image ||
    (obj?.images &&
      (obj.images.full || obj.images.normal || obj.images.small)) ||
    null
  );
}

async function fetchLorcanaJsonImageFor(card) {
  try {
    const dataset = await fetchLorcanaJsonDataset();
    if (!dataset?.length) return null;

    // Find by exact name first; then prefer set+number; finally first same-name
    const candByName = dataset.filter(
      (c) => norm(c.name || c.Name) === norm(card.name)
    );

    let best = candByName.find(
      (c) =>
        (!card.number ||
          String(c.number || c.Collector_Number || c.collector_number || "")
            .toLowerCase() === String(card.number).toLowerCase()) &&
        norm(c.set || c.Set || c.Set_Name || c.set_name) === norm(card.set)
    );

    if (!best && card.number) {
      best = candByName.find(
        (c) =>
          String(c.number || c.Collector_Number || c.collector_number || "")
            .toLowerCase() === String(card.number).toLowerCase()
      );
    }
    if (!best) {
      best = candByName.find(
        (c) =>
          norm(c.set || c.Set || c.Set_Name || c.set_name) === norm(card.set)
      );
    }
    if (!best && candByName.length) best = candByName[0];

    const uri = best ? pickAnyImageField(best) : null;
    return uri || null;
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
  params.set("game", "disney-lorcana"); // safety

  const limit      = searchParams.get("limit") ?? "20";
  const printing   = searchParams.get("printing") ?? "";
  const condition  = searchParams.get("condition") ?? ""; // your UI forces NM already
  const currency   = (searchParams.get("currency") || "USD").toUpperCase(); // USD | GBP
  const withImages = (searchParams.get("images") ?? "1") !== "0"; // ?images=0 to skip
  const cardId     = searchParams.get("cardId"); // precise fetch

  if (printing)  params.set("printing", printing);
  if (condition) params.set("condition", condition);
  if (limit)     params.set("limit", limit);
  if (cardId)    params.set("cardId", cardId);

  try {
    const upstream = await fetch(`${JUSTTCG_CARDS}?${params.toString()}`, {
      headers: { "x-api-key": apiKey },
      next: { revalidate: 30 }, // light cache
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = data?.error || data?.message || "JustTCG request failed";
      return NextResponse.json({ error: message }, { status: upstream.status });
    }

    if (!Array.isArray(data?.data)) {
      return NextResponse.json({ ...data, currency }, { status: 200 });
    }

    // Optional GBP conversion
    if (currency === "GBP") {
      for (const card of data.data) {
        if (Array.isArray(card.variants)) {
          for (const v of card.variants) {
            if (typeof v.price === "number") v.price = usdToGbp(v.price);
          }
        }
      }
    }

    // Image enrichment (LORCAST → LORCANA_API → LORCANAJSON)
    if (withImages) {
      const slice = data.data.slice(0, 16); // cap for speed
      for (let i = 0; i < slice.length; i++) {
        const c = slice[i];

        let uri = await fetchLorcastImageFor(c);
        if (!uri) uri = await fetchLorcanaApiImageFor(c);
        if (!uri) uri = await fetchLorcanaJsonImageFor(c);

        if (uri) c.image = uri;

        // brief pause to be polite to providers
        await sleep(60);
      }
    }

    return NextResponse.json({ ...data, currency }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Server error contacting providers" },
      { status: 502 }
    );
  }
}
