"use client";
import React, { useEffect, useRef, useState } from "react";

/* ——— Customize this if you get a direct image link later ——— */
const LOGO_URL = "https://ibb.co/m1pv25c"; // will be hidden if it doesn't resolve to an image

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
  const [showLogo, setShowLogo] = useState(true);

  // load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("lorcanaBag");
      if (raw) setBag(JSON.parse(raw));
    } catch {}
  }, []);
  // persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("lorcanaBag", JSON.stringify(bag));
    } catch {}
  }, [bag]);

  // ---- helpers ----
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
  const NM = "NM";
  const NM_FULL = expandCond(NM);

  function fmt(n) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  }

  function bestPriceNM(variants = []) {
    let vs = variants.filter((v) => v?.condition === NM_FULL || v?.condition === NM);
    if (printing)
      vs = vs.filter((v) => (v.printing || "").toLowerCase() === printing.toLowerCase());
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
    const nmOnly = (card.variants || []).filter(
      (v) => v?.condition === NM || v?.condition === NM_FULL
    );
    if (wanted) {
      const hit = nmOnly.find(
        (v) => (v.printing || "").toLowerCase() === wanted.toLowerCase()
      );
      if (hit) return hit;
    }
    // fallback: cheapest NM
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
      params.set("condition", NM); // force NM
      if (printing) params.set("printing", printing);
      params.set("limit", "20");
      params.set("currency", currency);

      const res = await fetch(`/api/cards?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || "Request failed");
      const arr = Array.isArray(json?.data) ? json.data : [];
      setResults(arr);

      // seed default printing choices/qty for each card
      const nextPrint = {};
      const nextQty = {};
      for (const c of arr) {
        const choices = nmPrintings(c);
        const preferred =
          (printing && choices.find((p) => p.toLowerCase() === printing.toLowerCase())) ||
          choices[0] ||
          "";
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

  // fetch precise by id (also re-seed choices)
  async function fetchByCardId(cardId) {
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const params = new URLSearchParams({ currency, condition: NM });
      const res = await fetch(
        `/api/cards?cardId=${encodeURIComponent(cardId)}&${params.toString()}`,
        { cache: "no-store" }
      );
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

  // ---- type-ahead suggestions (NM only, images off) ----
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
        const params = new URLSearchParams({
          q,
          limit: "10",
          currency,
          images: "0",
          condition: NM,
        });
        const res = await fetch(`/api/cards?${params.toString()}`, { signal: controller.signal });
        const json = await res.json();
        if (res.ok) {
          const items = (json?.data || []).map((card) => ({
            id: card.id,
            name: card.name,
            set: card.set,
            number: card.number,
          }));
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
        return prev.map((x) =>
          x.key === key ? { ...x, qty: Math.min(999, (Number(x.qty) || 0) + qty) } : x
        );
      } else {
        return [
          ...prev,
          {
            key,
            id: card.id,
            name: card.name,
            set: card.set,
            number: card.number,
            printing: p,
            unitPrice: variant.price,
            currency,
            qty,
            image: card.image || null,
          },
        ];
      }
    });
    setBagOpen(true);
  }

  function updateQty(key, nextQty) {
    setBag((prev) =>
      prev
        .map((x) => (x.key === key ? { ...x, qty: Math.max(0, Math.min(999, Number(nextQty) || 0)) } : x))
        .filter((x) => x.qty > 0)
    );
  }
  function removeItem(key) {
    setBag((prev) => prev.filter((x) => x.key !== key));
  }
  function clearBag() {
    setBag([]);
  }

  // Auto-reprice bag on currency change (fetch fresh NM prices for the same card+printing)
  useEffect(() => {
    let cancelled = false;
    async function reprice() {
      if (!bag.length) return;
      const updated = [];
      for (const it of bag) {
        try {
          const res = await fetch(
            `/api/cards?cardId=${encodeURIComponent(it.id)}&currency=${currency}&condition=NM&images=0`,
            { cache: "no-store" }
          );
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

  // ---------------- UI ----------------

  return (
    <main
      className="
        min-h-screen text-slate-900 p-6
        bg-[radial-gradient(1200px_800px_at_-10%_-10%,rgba(99,102,241,0.25),transparent_60%),radial-gradient(1000px_700px_at_110%_20%,rgba(168,85,247,0.22),transparent_60%),linear-gradient(180deg,rgba(241,245,249,0.85),rgba(241,245,249,0.85))]
      "
    >
      <div className="max-w-6xl mx-auto">
        {/* Header / Brand */}
        <div
          className="
            relative flex items-center justify-between gap-4
            rounded-3xl border border-white/30 bg-white/40 backdrop-blur-xl
            shadow-[0_10px_30px_-10px_rgba(56,189,248,0.35)]
            px-5 py-4
          "
        >
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/70 via-fuchsia-500/60 to-cyan-400/60 ring-1 ring-white/40 shadow-inner" />
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-700 via-fuchsia-700 to-cyan-700">
                Professor Dan Checker
              </h1>
              <p className="text-xs text-slate-600/80 mt-0.5">
                Search Disney Lorcana cards · Near Mint prices · Build a value bag
              </p>
            </div>
          </div>

          {/* Logo on the right (hidden if the URL isn’t a direct image) */}
          {showLogo ? (
            <img
              src={LOGO_URL}
              alt="Professor Dan"
              className="h-10 w-auto rounded-lg border border-white/30 shadow-sm"
              onError={() => setShowLogo(false)}
            />
          ) : null}
        </div>

        {/* Search form (glass) */}
        <form
          onSubmit={handleSearch}
          className="
            mt-6 grid gap-3 md:grid-cols-[1fr_auto_auto_auto]
            items-end rounded-3xl border border-white/30 bg-white/50 backdrop-blur-xl p-4
            shadow-[0_8px_24px_-8px_rgba(99,102,241,0.25)]
          "
        >
          <div className="flex flex-col relative" ref={suggestRef}>
            <label className="text-xs font-semibold text-slate-700/80">Search</label>
            <input
              className="
                mt-1 rounded-xl border border-white/40 bg-white/70
                px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300/60
                placeholder:text-slate-400/80
              "
              placeholder="e.g., Elsa Spirit of Winter, Tinker Bell, Mickey 25/P1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
              aria-autocomplete="list"
              aria-expanded={showSuggest}
            />
            {/* Suggestions (glass dropdown) */}
            {showSuggest && suggestions.length > 0 && (
              <ul
                className="
                  absolute z-20 top-full mt-1 w-full max-h-72 overflow-auto
                  rounded-xl border border-white/30 bg-white/60 backdrop-blur-xl shadow-xl
                "
                role="listbox"
              >
                {suggestions.map((s, i) => (
                  <li
                    key={s.id}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={`px-3 py-2 text-sm cursor-pointer ${
                      i === activeIndex ? "bg-indigo-50/70" : "hover:bg-slate-50/70"
                    }`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      chooseSuggestion(s);
                    }}
                  >
                    <div className="font-medium leading-tight">{s.name}</div>
                    <div className="text-xs text-slate-600/80">{s.set} · #{s.number}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col">
            <label className="text-xs font-semibold text-slate-700/80">Printing (filter)</label>
            <select
              className="
                mt-1 rounded-xl border border-white/40 bg-white/70 px-3 py-2
                focus:outline-none focus:ring-2 focus:ring-indigo-300/

