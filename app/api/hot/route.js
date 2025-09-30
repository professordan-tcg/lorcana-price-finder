// app/api/hot/route.js
import { NextResponse } from "next/server";

/**
 * Hot Sellers (JustTCG only)
 * - Samples Disney Lorcana cards from JustTCG (/v1/cards?game=disney-lorcana)
 * - Ranks by price momentum: 24h or 7d (uses variant.priceChange24hr / priceChange7d)
 * - Enriches top N with image + currency-adjusted NM price via our own /api/cards
 *
 * Env:
 *   JUSTTCG_API_KEY  (required)
 *
 * Query params:
 *   window   = "24h" | "7d"   (default "7d")
 *   limit    = number         (default 48, max 60)
 *   pages    = number         (default 4)  // how many pages of sampling (× pageSize)
 *   pageSize = number         (default 50) // JustTCG page size
 *   currency = "GBP" | "USD"  (default "GBP")
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const windowKey = (searchParams.get("window") || "7d").toLowerCase(); // "24h" | "7d"
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 48), 1), 60);
  const pages = Math.min(Math.max(Number(searchParams.get("pages") || 4), 1), 10);
  const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize") || 50), 10), 100);
  const currency = (searchParams.get("currency") || "GBP").toUpperCase();
  const origin = new URL(req.url).origin;

  const API_KEY = process.env.JUSTTCG_API_KEY;
  if (!API_KEY) {
    return NextResponse.json(
      { source: "justtcg", error: "Missing JUSTTCG_API_KEY", data: [] },
      { status: 500 }
    );
  }

  try {
    // 1) Sample multiple pages of Lorcana cards (NM variants only for signal)
    // JustTCG base: https://api.justtcg.com/v1  (docs)  :contentReference[oaicite:1]{index=1}
    const base = "https://api.justtcg.com/v1/cards";
    const sampled = [];
    for (let i = 0; i < pages; i++) {
      const url = new URL(base);
      // The docs show /cards accepts game, set, limit, offset, etc.  :contentReference[oaicite:2]{index=2}
      url.searchParams.set("game", "disney-lorcana");
      url.searchParams.set("condition", "NM"); // we only need NM trend signal
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(i * pageSize));

      const res = await fetch(url.toString(), {
        headers: { "x-api-key": API_KEY },
        cache: "no-store",
      });
      if (!res.ok) break;
      const j = await res.json();
      const arr = Array.isArray(j?.data) ? j.data : [];
      sampled.push(...arr);
      if (arr.length < pageSize) break; // last page
    }

    // 2) Compute a "hot score" per card from its NM variants
    //    score = max(variant.priceChange{windowKey}) across NM printings (Normal/Foil)
    function expandCond(abbr) {
      const map = { NM: "Near Mint" };
      return map[abbr] || abbr;
    }
    const NM = "NM";
    const NM_FULL = expandCond(NM);

    const candidates = sampled.map((card) => {
      const nm = (card.variants || []).filter(
        (v) => v?.condition === NM || v?.condition === NM_FULL
      );
      let bestPct = null;
      let bestVariant = null;
      for (const v of nm) {
        const pct =
          windowKey === "24h" ? v?.priceChange24hr ?? null : v?.priceChange7d ?? null;
        if (pct == null) continue;
        if (bestPct == null || pct > bestPct) {
          bestPct = pct;
          bestVariant = v;
        }
      }
      return {
        id: card.id,
        name: card.name,
        set: card.set,
        number: card.number,
        rarity: card.rarity || null,
        bestPct,
        bestVariant,
      };
    });

    const ranked = candidates
      .filter((c) => c.bestPct != null)
      .sort((a, b) => b.bestPct - a.bestPct)
      .slice(0, limit);

    // 3) Enrich TOP items via our own /api/cards for image + currency-correct price
    const enriched = [];
    for (const c of ranked) {
      try {
        const url = `${origin}/api/cards?cardId=${encodeURIComponent(
          c.id
        )}&condition=NM&images=1&currency=${encodeURIComponent(currency)}`;
        const r = await fetch(url, { cache: "no-store" });
        const j = await r.json();
        const card = Array.isArray(j?.data) ? j.data[0] : null;

        let image = null;
        let imageLarge = null;
        let livePrice = null;
        let printing = c.bestVariant?.printing || "Normal";
        if (card) {
          image = card.image || null;
          imageLarge = card.imageLarge || null;
          // pick matching printing if possible, else cheapest NM
          const nm = (card.variants || []).filter(
            (v) => v?.condition === "Near Mint" || v?.condition === "NM"
          );
          let chosen =
            nm.find(
              (v) => (v.printing || "").toLowerCase() === (printing || "").toLowerCase()
            ) || null;
          if (!chosen) {
            for (const v of nm) {
              if (typeof v.price === "number" &&
                  (chosen == null || v.price < chosen.price)) {
                chosen = v;
                printing = v.printing || printing;
              }
            }
          }
          if (chosen?.price != null) livePrice = chosen.price;
        }

        enriched.push({
          id: c.id,
          name: c.name,
          set: c.set,
          number: c.number,
          rarity: c.rarity,
          image,
          imageLarge,
          printing,
          trendWindow: windowKey,
          trendPct: c.bestPct, // from JustTCG variant priceChange{window}
          livePrice, // currency-specific (from our proxy)
        });
      } catch {
        enriched.push({
          id: c.id,
          name: c.name,
          set: c.set,
          number: c.number,
          rarity: c.rarity,
          image: null,
          imageLarge: null,
          printing: c.bestVariant?.printing || "Normal",
          trendWindow: windowKey,
          trendPct: c.bestPct,
          livePrice: null,
        });
      }
    }

    return NextResponse.json(
      {
        source: "justtcg",
        window: windowKey,
        data: enriched,
        note:
          "Ranked by JustTCG % price change on Near Mint variants (24h or 7d). Sales counts are not exposed by JustTCG; this is a momentum view.",
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { source: "justtcg", error: e?.message || "Failed to build hot list", data: [] },
      { status: 502 }
    );
  }
}
