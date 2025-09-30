// app/api/hot/route.js
import { NextResponse } from "next/server";

/**
 * Hot sellers powered by your existing /api/cards (JustTCG proxy).
 * We fan out several seed queries (q=a, e, i, ...), merge results,
 * pick the best NM variant trend per card, score & recommend.
 *
 * Query:
 *   window   = "24h" | "7d"         (default "7d")
 *   currency = "GBP" | "USD"        (default "GBP")
 *   limit    = 48                   (max 60)
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const windowKey = (searchParams.get("window") || "7d").toLowerCase(); // "24h"|"7d"
  const currency = (searchParams.get("currency") || "GBP").toUpperCase();
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 48), 1), 60);
  const origin = new URL(req.url).origin;

  // Seeds to cover lots of cards without a dedicated "game" param
  const seeds = ["a","e","i","o","u","ra","el","li","mi","ti","ka","an","mo","lo","ri","al"];
  const perSeed = 40;

  try {
    const all = new Map(); // id -> card
    for (const q of seeds) {
      const url = `${origin}/api/cards?q=${encodeURIComponent(q)}&limit=${perSeed}&images=0&condition=NM&currency=${currency}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const json = await res.json().catch(() => ({}));
      const arr = Array.isArray(json?.data) ? json.data : [];
      for (const c of arr) all.set(c.id, c);
    }

    const cards = Array.from(all.values());

    // Helpers
    const expandCond = (abbr) => (abbr === "NM" ? "Near Mint" : abbr);
    const NM = "NM", NM_FULL = expandCond(NM);
    const getTrend = (v, w) => {
      // Try common field names
      const tryKeys = w === "24h"
        ? ["priceChange24hr","priceChange24h","change24h","change24hr","pct24h","pct24hr"]
        : ["priceChange7d","change7d","pct7d"];
      for (const k of tryKeys) {
        const val = v?.[k];
        if (val == null) continue;
        const num = Number(val);
        if (Number.isFinite(num)) return num;
      }
      return null;
    };

    const scored = cards.map((card) => {
      const nm = (card.variants || []).filter(v => v?.condition === NM || v?.condition === NM_FULL);
      let best24 = null, best7 = null, bestV = null;
      for (const v of nm) {
        const t24 = getTrend(v, "24h");
        const t7  = getTrend(v, "7d");
        const composite = (t7 ?? -1e9) * 0.8 + (t24 ?? 0) * 0.2;
        if (bestV == null || composite > ((best7 ?? -1e9)*0.8 + (best24 ?? 0)*0.2)) {
          best24 = t24; best7 = t7; bestV = v;
        }
      }
      const t24 = best24 ?? null;
      const t7  = best7  ?? null;

      // Simple recommendation logic
      let recommendation = "Watch";
      let reason = "Stable";
      if (t7 != null) {
        if (t7 >= 10 && (t24 ?? 0) >= 2) { recommendation = "Sell now"; reason = "Surging (7d↑ & 24h↑)"; }
        else if (t7 >= 5)               { recommendation = "Consider listing"; reason = "Building uptrend (7d↑)"; }
        else if (t7 > 0)                { recommendation = "Watch"; reason = "Gentle rise"; }
        else if (t7 <= -5)              { recommendation = "Cooling"; reason = "Downtrend (7d↓)"; }
        else                            { recommendation = "Hold"; reason = "Flat"; }
      }

      const score = (t7 ?? -1e9) * 0.9 + (t24 ?? 0) * 0.1;

      return {
        id: card.id,
        name: card.name,
        set: card.set,
        number: card.number,
        rarity: card.rarity || null,
        printing: bestV?.printing || "Normal",
        trend24h: t24,
        trend7d: t7,
        score,
        recommendation,
        reason
      };
    })
    .filter(x => x.trend7d != null || x.trend24h != null)
    .sort((a,b) => b.score - a.score)
    .slice(0, limit);

    // Enrich top with image + live NM price via our own proxy (currency-correct)
    const enriched = [];
    for (const it of scored) {
      try {
        const r = await fetch(`${origin}/api/cards?cardId=${encodeURIComponent(it.id)}&condition=NM&images=1&currency=${currency}`, { cache: "no-store" });
        const j = await r.json();
        const card = Array.isArray(j?.data) ? j.data[0] : null;
        let image = null, imageLarge = null, livePrice = null, printing = it.printing;
        if (card) {
          image = card.image || null;
          imageLarge = card.imageLarge || null;
          const nm = (card.variants || []).filter(v => v?.condition === "Near Mint" || v?.condition === "NM");
          let chosen = nm.find(v => (v.printing || "").toLowerCase() === (printing || "").toLowerCase()) || null;
          if (!chosen) {
            for (const v of nm) if (typeof v.price === "number" && (!chosen || v.price < chosen.price)) chosen = v;
            if (chosen) printing = chosen.printing || printing;
          }
          if (chosen?.price != null) livePrice = chosen.price;
        }
        enriched.push({ ...it, image, imageLarge, livePrice, currency, printing });
      } catch {
        enriched.push({ ...it, image: null, imageLarge: null, livePrice: null, currency });
      }
    }

    return NextResponse.json({ source: "justtcg", window: windowKey, data: enriched }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ source: "justtcg", error: e?.message || "Failed to build list", data: [] }, { status: 502 });
  }
}
