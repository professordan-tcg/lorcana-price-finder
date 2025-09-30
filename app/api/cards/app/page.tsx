"use client";
import React, { useState } from "react";


// Simple UI that calls our server route /api/cards
export default function Page() {
const [query, setQuery] = useState("");
const [condition, setCondition] = useState("");
const [printing, setPrinting] = useState("");
const [currency, setCurrency] = useState<"USD" | "GBP">("GBP");
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
const [results, setResults] = useState<any[]>([]);


async function handleSearch(e?: React.FormEvent) {
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
} catch (err: any) {
setError(err?.message || "Something went wrong");
} finally {
setLoading(false);
}
}


function bestPrice(variants: any[] = []) {
if (!variants.length) return null;
let vs = variants;
if (condition) vs = vs.filter((v) => v.condition === expandCond(condition) || v.condition === condition);
if (printing) vs = vs.filter((v) => (v.printing || "").toLowerCase() === printing.toLowerCase());
if (!vs.length) vs = variants;
let best = vs[0];
for (const v of vs) if (typeof v.price === "number" && (best.price == null || v.price < best.price)) best = v;
return best;
}


function expandCond(abbr: string) {
const map: Record<string, string> = {
NM: "Near Mint",
LP: "Lightly Played",
MP: "Moderately Played",
HP: "Heavily Played",
DMG: "Damaged",
S: "Sealed",
};
return map[abbr] || abbr;
}


function fmt(n: number) {
return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
}


return (
<main className="min-h-screen bg-slate-50 text-slate-900 p-6">
<div className="max-w-5xl mx-auto">
<h1 className="text-3xl font-bold tracking-tight">Lorcana Price Finder <span className="text-slate-400">· JustTCG</span></h1>
<p className="text-slate-600 mt-1">Search Lorcana cards and see current variant prices (Normal/Foil, NM/LP/etc.).</p>


<form onSubmit={handleSearch} className="mt-5 grid gap-3 md:grid-cols-[1fr_auto_auto_auto_auto] items-end bg-white rounded-2xl shadow p-4">
<div className="flex flex-col">
<label className="text-xs font-semibold text-slate-600">Search</label>
<input
className="mt-1 rounded-xl border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
placeholder="e.g., Elsa Spirit of Winter, Tinker Bell, Mickey 25/P1"
}
