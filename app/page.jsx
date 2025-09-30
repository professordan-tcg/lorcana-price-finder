"use client";
import React, { useEffect, useRef, useState } from "react";

export default function Page() {
  // ---- search UI state ----
  const [query, setQuery] = useState("");
  const [printing, setPrinting] = useState(""); // filter (Any/Normal/Foil)
  const [currency, setCurrency] = useState("GBP");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);

  // ---- suggestions ----
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestRef = useRef(null);

  // ---- preview ----
  const [openPreviewId, setOpenPreviewId] = useState(null);

  // ---- per-card UI selections (printing + qty for "Add to bag") ----
  const [printingChoice, setPrintingChoice] = useState({}); // { [cardId]: "Normal" | "Foil" }
  const [qtyChoice, setQtyChoice] = useState({}); // { [cardId]: number }

  // ---- bag/collection ----
  const [bagOpen, setBagOpen] = useState(false);
  const [bag, setBag] = useState([]); // [{key,id,name,set,number,printing,unitPrice,currency,qty,image}]
  useEffect(() => {
    try {
      const raw = localStorage.getItem("lorcanaBag");
      if (raw) setBag(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("lorcanaBag", JSON.stringify(bag));
    } catch {}
  }, [bag]);

  // ---- helpers ----
  function expandCond(abbr) {
    const map = { NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged", S: "Sealed" };
    return map[abbr] || abbr;
  }
  const NM = "NM";
  const NM_FULL = expandCond(NM);

  function fmt(n) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  }

  function bestPriceNM(variants = []) {
    let vs = variants.filter((v) => v?.condition === NM_FULL || v?.condition === NM);
    if (printing) vs = vs.filter((v) => (v.printing || "").toLowerCase() === printing.toLowerCase());
    if (!vs.length) return null;
    let best = vs[0];
    for (const v of vs) {
      if (typeof v.price === "number" && (best.price == null || v.price < best.price)) best = v;
    }
    return best;
  }

  function nmPrintings(card) {
    const set = new Set(
      (card.variants || [])
        .filter((v) => v?.condition === NM || v?.condition === NM_FULL)
        .map((v) => (v.printing || "").trim())
        .filter(Boolean)
    );
    return Array.from(set);
  }

  function nmVariantForPrinting(card, wanted) {
    const nmOnly = (card.variants || []).filter((v) => v?.condition === NM || v?.condition === NM_FULL);
    if (wanted) {
      const hit = nmOnly.find((v) => (v.printing || "").toLowerCase() === wanted.toLowerCase());
      if (hit) return hit;
    }
    let best = null;
    for (const v of nmOnly) {
      if (typeof v.price === "number" && (best == null || v.price < best.price)) best = v;
    }
    return best;
  }

  // ---- searching ----
  async function handleSearch(e) {
    e?.preventDefault?.();
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      params.set("condition", NM);
      if (printing) params.set("printing", printing);
      params.set("limit", "20");
      params.set("currency", currency);

      const res = await fetch(`/api/cards?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || "Request failed");
      const arr = Array.isArray(json?.data) ? json.data : [];
      setResults(arr);

      const nextPrint = {};
      const nextQty = {};
      for (const c of arr) {
        const choices = nmPrintings(c);
        const preferred = (printing && choices.find((p) => p.toLowerCase() === printing.toLowerCase())) || choices[0] || "";
        nextPrint[c.id] = preferred || "";
        nextQty[c.id] = 1;
      }
      setPrintingChoice(nextPrint);
      setQtyChoice(nextQty);
      setOpenPreviewId(null);
    } catch (err) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function fetchByCardId(cardId) {
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const params = new URLSearchParams({ currency, condition: NM });
      const res = await fetch(`/api/cards?cardId=${encodeURIComponent(cardId)}&${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || "Request failed");
      const arr = Array.isArray(json?.data) ? json.data : [];
      setResults(arr);

      const nextPrint = {};
      const nextQty = {};
      for (const c of arr) {
        const choices = nmPrintings(c);
        const preferred = choices[0] || "";
        nextPrint[c.id] = preferred;
        nextQty[c.id] = 1;
      }
      setPrintingChoice(nextPrint);
      setQtyChoice(nextQty);
      setOpenPreviewId(null);
    } catch (err) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // ---- type-ahead suggestions ----
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setShowSuggest(false);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "10", currency, images: "0", condition: NM });
        const res = await fetch(`/api/cards?${params.toString()}`, { signal: controller.signal });
        const json = await res.json();
        if (res.ok) {
          const items = (json?.data || []).map((card) => ({ id: card.id, name: card.name, set: card.set, number: card.number }));
          setSuggestions(items);
          setShowSuggest(true);
          setActiveIndex(-1);
        } else {
          setSuggestions([]);
          setShowSuggest(false);
        }
      } catch {}
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [query, currency]);

  function handleKeyDown(e) {
    if (!showSuggest || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0) {
        e.preventDefault();
        chooseSuggestion(suggestions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setShowSuggest(false);
    }
  }
  function chooseSuggestion(s) {
    setQuery(s.name);
    setShowSuggest(false);
    fetchByCardId(s.id);
  }
  useEffect(() => {
    function onClick(e) {
      if (!suggestRef.current) return;
      if (!suggestRef.current.contains(e.target)) setShowSuggest(false);
    }
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  // ---- Bag helpers ----
  function bagTotal() {
    return bag.reduce((sum, it) => sum + (Number(it.unitPrice) || 0) * (Number(it.qty) || 0), 0);
  }
  const bagCount = bag.reduce((n, it) => n + (Number(it.qty) || 0), 0);

  function addToBag(card) {
    const chosen = printingChoice[card.id] || "";
    const variant = nmVariantForPrinting(card, chosen);
    if (!variant || typeof variant.price !== "number") return;

    const p = (variant.printing || chosen || "").trim() || "Normal";
    const qty = Math.max(1, Number(qtyChoice[card.id] || 1));
    const key = `${card.id}|${p.toLowerCase()}`;

    setBag((prev) => {
      const exist = prev.find((x) => x.key === key);
      if (exist) {
        return prev.map((x) => (x.key === key ? { ...x, qty: Math.min(999, (Number(x.qty) || 0) + qty) } : x));
      } else {
        return [
          ...prev,
          { key, id: card.id, name: card.name, set: card.set, number: card.number, printing: p, unitPrice: variant.price, currency, qty, image: card.image || null }
        ];
      }
    });
    setBagOpen(true);
  }
  function updateQty(key, nextQty) {
    setBag((prev) => prev.map((x) => (x.key === key ? { ...x, qty: Math.max(0, Math.min(999, Number(nextQty) || 0)) } : x)).filter((x) => x.qty > 0));
  }
  function removeItem(key) {
    setBag((prev) => prev.filter((x) => x.key !== key));
  }
  function clearBag() {
    setBag([]);
  }
  useEffect(() => {
    let cancelled = false;
    async function reprice() {
      if (!bag.length) return;
      const updated = [];
      for (const it of bag) {
        try {
          const res = await fetch(`/api/cards?cardId=${encodeURIComponent(it.id)}&currency=${currency}&condition=NM&images=0`, { cache: "no-store" });
          const json = await res.json();
          if (res.ok && Array.isArray(json?.data) && json.data[0]) {
            const card = json.data[0];
            const v = nmVariantForPrinting(card, it.printing);
            const newPrice = typeof v?.price === "number" ? v.price : it.unitPrice;
            updated.push({ ...it, unitPrice: newPrice, currency });
          } else {
            updated.push({ ...it, currency });
          }
        } catch {
          updated.push({ ...it, currency });
        }
      }
      if (!cancelled) setBag(updated);
    }
    reprice();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  // ---- UI ----
  return (
    <main className="min-h-screen text-slate-900 bg-gradient-to-br from-indigo-100 via-purple-100 to-sky-100">
      <div className="relative">
        {/* soft glow gradient overlay */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40%_30%_at_20%_20%,rgba(99,102,241,0.25),transparent),radial-gradient(35%_25%_at_80%_10%,rgba(168,85,247,0.20),transparent),radial-gradient(30%_35%_at_50%_90%,rgba(56,189,248,0.18),transparent)]"></div>

        <div className="relative max-w-6xl mx-auto px-6 py-8">
          {/* Header */}
          <header className="flex items-center gap-4">
            <img src="https://ibb.co/m1pv25c" alt="Professor Dan Logo" className="h-10 w-10 rounded-lg bg-white/70 backdrop-blur border border-white/40 object-cover" />
            <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-sky-600">Professor Dan Checker</h1>
            <span className="ml-auto text-xs font-semibold px-2.5 py-1 rounded-full bg-white/60 backdrop-blur border border-white/40 text-indigo-700">Live NM Prices</span>
          </header>

          <p className="mt-2 text-slate-700/90">
            Search Lorcana cards, see <strong>Near Mint</strong> prices (Normal/Foil), and add them to your collection bag.
          </p>

          {/* Search form */}
          <form onSubmit={handleSearch} className="mt-5 grid gap-3 md:grid-cols-[1fr_auto_auto_auto] items-end rounded-2xl border border-white/40 bg-white/60 backdrop-blur p-4 shadow-lg shadow-indigo-200/30">
            <div className="flex flex-col relative" ref={suggestRef}>
              <label className="text-xs font-semibold text-slate-700/80">Search</label>
              <input
                className="mt-1 rounded-xl border border-white/40 bg-white/70 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="e.g., Elsa Spirit of Winter, Tinker Bell, Mickey 25/P1"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
                aria-autocomplete="list"
                aria-expanded={showSuggest}
              />
              {showSuggest && suggestions.length > 0 && (
                <ul className="absolute z-20 top-full mt-1 w-full max-h-72 overflow-auto rounded-xl border border-white/40 bg-white/80 backdrop-blur shadow-lg" role="listbox">
                  {suggestions.map((s, i) => (
                    <li
                      key={s.id}
                      role="option"
                      aria-selected={i === activeIndex}
                      className={`px-3 py-2 text-sm cursor-pointer ${i === activeIndex ? "bg-indigo-50/80" : "hover:bg-indigo-50/50"}`}
                      onMouseEnter={() => setActiveIndex(i)}
                      onMouseDown={(e) => { e.preventDefault(); chooseSuggestion(s); }}
                    >
                      <div className="font-medium leading-tight">{s.name}</div>
                      <div className="text-xs text-slate-500">{s.set} · #{s.number}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-slate-700/80">Printing (filter)</label>
              <select
                className="mt-1 rounded-xl border border-white/40 bg-white/70 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-300"
                value={printing}
                onChange={(e) => setPrinting(e.target.value)}
              >
                <option value="">Any</option>
                <option value="Normal">Normal</option>
                <option value="Foil">Foil</option>
              </select>
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-slate-700/80">Currency</label>
              <select
                className="mt-1 rounded-xl border border-white/40 bg-white/70 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-300"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="GBP">GBP (£)</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>

            <button type="submit" className="inline-flex items-center justify-center rounded-2xl px-4 py-2 font-semibold shadow bg-gradient-to-r from-indigo-600 via-purple-600 to-sky-600 text-white hover:opacity-95 disabled:opacity-60" disabled={loading}>
              {loading ? "Searching…" : "Search"}
            </button>
          </form>

          <div className="mt-3 text-xs text-slate-600">
            Data via <code className="bg-white/60 px-1.5 py-0.5 rounded border border-white/40">/api/cards</code>. Prices in {currency}. Condition is <strong>Near Mint</strong>.
          </div>

          {/* Status */}
          {error && (
            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50/80 backdrop-blur text-red-800 p-3">
              <strong>Error:</strong> {error}
            </div>
          )}
          {!loading && !error && results.length === 0 && (
            <div className="mt-6 text-slate-600">No results yet. Try searching for a card name, set, or number.</div>
          )}
          {loading && <div className="mt-6 text-slate-700">Fetching live prices…</div>}

          {/* Results */}
          <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {results.map((card) => {
              const best = bestPriceNM(card.variants || []);
              const nmRows = (card.variants || [])
                .filter((v) => v?.condition === NM || v?.condition === NM_FULL)
                .filter((v) => !printing || (v.printing || "").toLowerCase() === printing.toLowerCase());

              const previewOpen = openPreviewId === card.id;
              const choices = nmPrintings(card);
              const chosen = printingChoice[card.id] ?? (choices[0] || "");

              return (
                <li key={card.id} className="relative rounded-2xl border border-white/40 bg-white/60 backdrop-blur p-4 shadow-lg shadow-purple-200/30 overflow-visible">
                  <div className="flex items-start gap-3">
                    {/* image + preview */}
                    {card.image && (
                      <div className="relative group shrink-0">
                        <img
                          src={card.image}
                          alt={`${card.name} card image`}
                          loading="lazy"
                          tabIndex={0}
                          className="w-20 h-auto rounded-lg border border-white/40"
                          onClick={(e) => { e.preventDefault(); setOpenPreviewId(previewOpen ? null : card.id); }}
                          aria-expanded={previewOpen}
                        />
                        {/* Hover preview */}
                        <div className="pointer-events-none hidden group-hover:flex group-focus-within:flex absolute left-24 top-0 z-40 p-2 rounded-xl border border-white/50 bg-white/90 backdrop-blur shadow-xl">
                          <img src={card.imageLarge || card.image} alt={`${card.name} large preview`} className="h-auto w-[22rem] max-w-[90vw] rounded-md" />
                        </div>
                        {/* Click-to-pin preview */}
                        {previewOpen && (
                          <div className="absolute left-24 top-0 z-50 p-2 rounded-xl border border-white/60 bg-white/95 backdrop-blur shadow-2xl max-w-[min(90vw,32rem)] max-h-[80vh] overflow-auto">
                            <div className="flex justify-between items-center mb-2">
                              <div className="text-sm font-semibold truncate pr-4">{card.name}</div>
                              <button type="button" className="text-xs px-2 py-1 rounded-md border border-white/50 hover:bg-indigo-50/60" onClick={() => setOpenPreviewId(null)}>Close</button>
                            </div>
                            <img src={card.imageLarge || card.image} alt={`${card.name} large preview`} className="h-auto w-[26rem] max-w-full rounded-md" />
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold leading-tight text-slate-800">{card.name}</div>
                          <div className="text-xs text-slate-600 mt-0.5">{card.set} · #{card.number} · {card.rarity || "—"}</div>
                        </div>

                        {best && (
                          <div className="text-right">
                            <div className="text-[10px] uppercase tracking-wide text-slate-500">From (Near Mint)</div>
                            <div className="text-lg font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
                              {typeof best.price === "number" ? fmt(best.price) : "—"}
                            </div>
                            <div className="text-[10px] text-slate-400">{best.printing || "—"}</div>
                          </div>
                        )}
                      </div>

                      {/* NM-only price table */}
                      {nmRows.length > 0 ? (
                        <div className="mt-3 overflow-hidden rounded-xl border border-white/40">
                          <table className="w-full text-sm">
                            <thead className="bg-indigo-50/60 text-slate-700">
                              <tr>
                                <th className="text-left px-3 py-2">Printing</th>
                                <th className="text-right px-3 py-2">Price (NM)</th>
                                <th className="text-right px-3 py-2">Updated</th>
                              </tr>
                            </thead>
                            <tbody>
                              {nmRows.map((v) => (
                                <tr key={v.id} className="odd:bg-white/60 even:bg-white/40">
                                  <td className="px-3 py-2">{v.printing || "—"}</td>
                                  <td className="px-3 py-2 text-right">{typeof v.price === "number" ? fmt(v.price) : "—"}</td>
                                  <td className="px-3 py-2 text-right">{v.lastUpdated ? new Date(v.lastUpdated * 1000).toLocaleDateString() : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-600 mt-2">No Near Mint pricing available.</div>
                      )}

                      {/* Add to Bag */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <label className="text-xs text-slate-700">I have:</label>
                        <select
                          className="rounded-lg border border-white/40 bg-white/70 px-2 py-1 text-sm"
                          value={printingChoice[card.id] ?? chosen}
                          onChange={(e) => setPrintingChoice((m) => ({ ...m, [card.id]: e.target.value }))}
                        >
                          {choices.length === 0 && <option value="">—</option>}
                          {choices.map((p) => (
                            <option key={p || "Normal"} value={p || "Normal"}>{p || "Normal"}</option>
                          ))}
                        </select>

                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={qtyChoice[card.id] ?? 1}
                          onChange={(e) => setQtyChoice((m) => ({ ...m, [card.id]: Math.max(1, Math.min(999, Number(e.target.value) || 1)) }))}
                          className="w-20 rounded-lg border border-white/40 bg-white/70 px-2 py-1 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => addToBag(card)}
                          className="rounded-xl px-3 py-1.5 text-sm font-semibold shadow bg-gradient-to-r from-indigo-600 via-purple-600 to-sky-600 text-white hover:opacity-95"
                        >
                          Add to Bag
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Floating Bag button */}
      <button
        onClick={() => setBagOpen(true)}
        className="fixed bottom-5 right-5 inline-flex items-center gap-2 rounded-2xl px-4 py-2 font-semibold shadow-lg bg-gradient-to-r from-indigo-600 via-purple-600 to-sky-600 text-white hover:opacity-95"
        aria-label="Open Bag"
      >
        <span>👜 Bag</span>
        <span className="text-xs bg-white/20 px-2 py-0.5 rounded">{bagCount}</span>
        <span className="ml-1 text-sm">{fmt(bagTotal())}</span>
      </button>

      {/* Bag drawer */}
      {bagOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/30" onClick={() => setBagOpen(false)} aria-hidden="true" />
          <aside className="w-full max-w-md bg-white/80 backdrop-blur h-full shadow-2xl border-l border-white/50 p-4 overflow-auto">
            <div className="flex items-center justify-between">
              <div className="text-lg font-bold">Your Bag</div>
              <button className="rounded-md border border-white/50 bg-white/70 px-2 py-1 text-sm hover:bg-indigo-50/60" onClick={() => setBagOpen(false)}>Close</button>
            </div>
            <div className="text-xs text-slate-700 mt-1">Currency: <strong>{currency}</strong> (prices auto-refresh when you switch)</div>

            {bag.length === 0 ? (
              <div className="mt-6 text-slate-600">No items yet. Add cards from the results.</div>
            ) : (
              <>
                <ul className="mt-4 space-y-3">
                  {bag.map((it) => (
                    <li key={it.key} className="flex gap-3 border border-white/50 bg-white/70 rounded-xl p-3">
                      {it.image && <img src={it.image} alt={`${it.name} image`} className="w-14 h-auto rounded border border-white/50" loading="lazy" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{it.name}</div>
                        <div className="text-xs text-slate-600 truncate">{it.set} · #{it.number} · {it.printing}</div>
                        <div className="mt-2 flex items-center justify-between">
                          <div className="text-sm">Unit: <strong>{fmt(it.unitPrice)}</strong></div>
                          <div className="flex items-center gap-1">
                            <button className="px-2 py-1 rounded border border-white/50 bg-white/70 text-sm" onClick={() => updateQty(it.key, (Number(it.qty) || 0) - 1)}>−</button>
                            <input type="number" min={1} max={999} value={it.qty} onChange={(e) => updateQty(it.key, Number(e.target.value) || 0)} className="w-16 text-center rounded border border-white/50 bg-white/70 text-sm" />
                            <button className="px-2 py-1 rounded border border-white/50 bg-white/70 text-sm" onClick={() => updateQty(it.key, (Number(it.qty) || 0) + 1)}>+</button>
                          </div>
                        </div>
                        <div className="mt-1 text-right text-sm">Line: <strong>{fmt((Number(it.unitPrice) || 0) * (Number(it.qty) || 0))}</strong></div>
                      </div>
                      <button className="self-start text-xs px-2 py-1 rounded-md border border-red-200 bg-white/80 text-red-700 hover:bg-red-50" onClick={() => removeItem(it.key)} title="Remove">Remove</button>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 border-t border-white/50 pt-3">
                  <div className="flex items-center justify-between text-base">
                    <div>Total</div>
                    <div className="font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">{fmt(bagTotal())}</div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button className="rounded-xl px-3 py-2 text-sm font-semibold border border-white/50 bg-white/70 hover:bg-indigo-50/60" onClick={clearBag}>Clear Bag</button>
                    <button className="rounded-xl px-3 py-2 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 via-purple-600 to-sky-600 hover:opacity-95" onClick={() => navigator.clipboard.writeText(summaryText(bag, currency, fmt))}>Copy Summary</button>
                  </div>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

// ----- helpers outside component -----
function summaryText(bag, currency, fmt) {
  const lines = [];
  for (const it of bag) {
    lines.push(`${it.name} (${it.set} #${it.number}, ${it.printing}) x${it.qty} — ${fmt((Number(it.unitPrice) || 0) * (Number(it.qty) || 0))}`);
  }
  const total = bag.reduce((s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.qty) || 0), 0);
  lines.push(`\nTotal (${currency}): ${fmt(total)}`);
  return lines.join("\n");
}

