"use client";
import React, { useState } from "react";

export default function Page() {
  const [query, setQuery] = useState("");
  const [condition, setCondition] = useState("");
  const [printing, setPrinting] = useState("");
  const [currency, setCurrency] = useState("GBP"); // default to GBP
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);

  async function handleSearch(e) {
    e?.preventDefault?.();
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (condition) params.set("condition", condition);
      if (printing) params.set("printing", printing);
      params.set("limit", "20");
      params.set("currency", currency);

      const res = await fetch(`/api/cards?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || "Request failed");
      setResults(Array.isArray(json?.data) ? json.data : []);
    } catch (err) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function expandCond(abbr) {
    const map = {
      NM: "Near Mint",
      LP: "Lightly Played",
      MP: "Moderately Played",
      HP: "Heavily Played",
      DMG: "Damaged",
      S: "Sealed",
    };
    return map[abbr] || abbr;
  }

  function bestPrice(variants = []) {
    if (!variants.length) return null;
    let vs = variants;
    if (condition) vs = vs.filter(v => v.condition === expandCond(condition) || v.condition === condition);
    if (printing) vs = vs.filter(v => (v.printing || "").toLowerCase() === printing.toLowerCase());
    if (!vs.length) vs = variants;
    let best = vs[0];
    for (const v of vs) {
      if (typeof v.price === "number" && (best.price == null || v.price < best.price)) best = v;
    }
    return best;
  }

  function fmt(n) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight">
          Lorcana Price Finder <span className="text-slate-400">· JustTCG</span>
        </h1>
        <p className="text-slate-600 mt-1">
          Search Lorcana cards and see current variant prices (Normal/Foil, NM/LP/etc.).
        </p>

        <form
          onSubmit={handleSearch}
          className="mt-5 grid gap-3 md:grid-cols-[1fr_auto_auto_auto_auto] items-end bg-white rounded-2xl shadow p-4"
        >
          <div className="flex flex-col">
            <label className="text-xs font-semibold text-slate-600">Search</label>
            <input
              className="mt-1 rounded-xl border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
              placeholder="e.g., Elsa Spirit of Winter, Tinker Bell, Mickey 25/P1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs font-semibold text-slate-600">Condition</label>
            <select
              className="mt-1 rounded-xl border border-slate-200 px-3 py-2"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              <option value="">Any</option>
              <option value="NM">Near Mint (NM)</option>
              <option value="LP">Lightly Played (LP)</option>
              <option value="MP">Moderately Played (MP)</option>
              <option value="HP">Heavily Played (HP)</option>
              <option value="DMG">Damaged (DMG)</option>
              <option value="S">Sealed</option>
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-xs font-semibold text-slate-600">Printing</label>
            <select
              className="mt-1 rounded-xl border border-slate-200 px-3 py-2"
              value={printing}
              onChange={(e) => setPrinting(e.target.value)}
            >
              <option value="">Any</option>
              <option value="Normal">Normal</option>
              <option value="Foil">Foil</option>
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-xs font-semibold text-slate-600">Currency</label>
            <select
              className="mt-1 rounded-xl border border-slate-200 px-3 py-2"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="GBP">GBP (£)</option>
              <option value="USD">USD ($)</option>
            </select>
          </div>

          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-2xl px-4 py-2 font-semibold shadow bg-slate-900 text-white hover:opacity-90"
            disabled={loading}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        <div className="mt-3 text-xs text-slate-500">
          Data via <code>/api/cards</code> → JustTCG <code>GET /v1/cards</code>. Prices shown in {currency}.
        </div>

        {error && (
          <div className="mt-5 bg-red-50 border border-red-200 text-red-800 rounded-xl p-3">
            <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && !error && results.length === 0 && (
          <div className="mt-6 text-slate-500">No results yet. Try searching for a card name, set, or number.</div>
        )}

        {loading && <div className="mt-6 text-slate-600">Fetching live prices…</div>}

        <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {results.map((card) => {
            const best = bestPrice(card.variants);
            return (
              <li key={card.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold leading-tight">{card.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {card.set} · #{card.number} · {card.rarity || "—"}
                    </div>
                  </div>
                  {best && (
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-wide text-slate-500">From</div>
                      <div className="text-lg font-extrabold">
                        {typeof best.price === "number" ? fmt(best.price) : "—"}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {best.printing || "—"} · {best.condition || "—"}
                      </div>
                    </div>
                  )}
                </div>

                {Array.isArray(card.variants) && card.variants.length > 0 ? (
                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-100">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="text-left px-3 py-2">Printing</th>
                          <th className="text-left px-3 py-2">Condition</th>
                          <th className="text-right px-3 py-2">Price</th>
                          <th className="text-right px-3 py-2">Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {card.variants.map((v) => (
                          <tr key={v.id} className="odd:bg-white even:bg-slate-50/50">
                            <td className="px-3 py-2">{v.printing || "—"}</td>
                            <td className="px-3 py-2">{v.condition || "—"}</td>
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
                ) : (
                  <div className="text-sm text-slate-500 mt-2">No variant pricing available.</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
