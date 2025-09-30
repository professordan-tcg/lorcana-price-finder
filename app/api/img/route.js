// app/api/img/route.js
import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const u = searchParams.get("u");
  if (!u || !/^https?:\/\//i.test(u)) {
    return NextResponse.json({ error: "Missing or invalid ?u=<image-url>" }, { status: 400 });
  }

  try {
    const resp = await fetch(u, { cache: "no-store" });
    if (!resp.ok) {
      return NextResponse.json({ error: `Upstream ${resp.status}` }, { status: 502 });
    }

    const ct = resp.headers.get("content-type") || "image/jpeg";
    const buf = await resp.arrayBuffer();
    return new Response(buf, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Proxy fetch failed" }, { status: 502 });
  }
}
