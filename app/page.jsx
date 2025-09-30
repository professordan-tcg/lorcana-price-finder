"use client";
import React, { useEffect, useRef, useState } from "react";


export default function Page() {
const [query, setQuery] = useState("");
const [condition, setCondition] = useState("");
const [printing, setPrinting] = useState("");
const [currency, setCurrency] = useState("GBP"); // default to GBP
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);
const [results, setResults] = useState([]);


// NEW: Suggestions state
const [suggestions, setSuggestions] = useState([]);
const [showSuggest, setShowSuggest] = useState(false);
const [activeIndex, setActiveIndex] = useState(-1);
const suggestRef = useRef(null);


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


const res = await fetch(`/api/cards?${params.toString()}`, { cache: "no-store" });
const json = await res.json();
if (!res.ok) throw new Error(json?.error || json?.message || "Request failed");
setResults(Array.isArray(json?.data) ? json.data : []);
} catch (err) {
setError(err?.message || "Something went wrong");
} finally {
setLoading(false);
}
}


// Fetch a single card precisely by cardId
async function fetchByCardId(cardId) {
setLoading(true);
setError(null);
setResults([]);
try {
const params = new URLSearchParams({ currency });
const res = await fetch(`/api/cards?cardId=${encodeURIComponent(cardId)}&${params.toString()}`, { cache: "no-store" });
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
const map = { NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged", S: "Sealed" };
return map[abbr] || abbr;
}


function bestPrice(variants = []) {
if (!variants.length) return null;
let vs = variants;
if (condition) vs = vs.filter(v => v.condition === expandCond(condition) || v.condition === condition);
if (printing) vs = vs.filter(v => (v.printing || "").toLowerCase() === printing.toLowerCase());
if (!vs.length) vs = variants;
let best = vs[0];
for (const v of vs) if (typeof v.price === "number" && (best.price == null || v.price < best.price)) best = v;
return best;
}


function fmt(n) {
return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
}


}
