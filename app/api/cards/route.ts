import { NextResponse } from "next/server";


const API_BASE = "https://api.justtcg.com/v1/cards";


// Optional: configure a server-side FX rate so we can output GBP
// Set JUSTTCG_GBP_PER_USD in env (e.g., 0.78 means $1 = £0.78)
function usdToGbp(usd: number): number {
const rate = Number(process.env.JUSTTCG_GBP_PER_USD || "");
if (!rate || !isFinite(rate)) return usd; // fallback: return USD unchanged
return usd * rate;
}


export async function GET(request: Request) {
const apiKey = process.env.JUSTTCG_API_KEY;
if (!apiKey) {
return NextResponse.json(
{ error: "Server missing JUSTTCG_API_KEY" },
{ status: 500 }
);
}


const { searchParams } = new URL(request.url);


// Build pass-through query
const params = new URLSearchParams();
const q = searchParams.get("q") ?? "";
if (q) params.set("q", q);
params.set("game", "disney-lorcana");


const condition = searchParams.get("condition") ?? ""; // NM, LP, etc.
const printing = searchParams.get("printing") ?? ""; // Normal, Foil
const limit = searchParams.get("limit") ?? "20";
const currency = (searchParams.get("currency") || "USD").toUpperCase(); // USD or GBP


if (condition) params.set("condition", condition);
if (printing) params.set("printing", printing);
if (limit) params.set("limit", limit);


try {
const upstream = await fetch(`${API_BASE}?${params.toString()}` , {
headers: { "x-api-key": apiKey },
next: { revalidate: 30 },
});


const data = await upstream.json().catch(() => ({}));


if (!upstream.ok) {
const message = data?.error || data?.message || "JustTCG request failed";
return NextResponse.json({ error: message }, { status: upstream.status });
}


// Convert prices if GBP requested and we have a rate
if (currency === "GBP" && data?.data && Array.isArray(data.data)) {
for (const card of data.data) {
if (Array.isArray(card.variants)) {
for (const v of card.variants) {
if (typeof v.price === "number") v.price = usdToGbp(v.price);
}
}
}
}


return NextResponse.json({ ...data, currency }, { status: 200 });
} catch (err: any) {
return NextResponse.json(
{ error: err?.message || "Server error contacting JustTCG" },
{ status: 502 }
);
}
}
```ts
import { NextResponse } from "next/server";


const API_BASE = "https://api.justtcg.com/v1/cards";


export async function GET(request: Request) {
const apiKey = process.env.JUSTTCG_API_KEY;
if (!apiKey) {
return NextResponse.json(
{ error: "Server missing JUSTTCG_API_KEY" },
{ status: 500 }
);
}


const { searchParams } = new URL(request.url);


// Build pass-through query
}
