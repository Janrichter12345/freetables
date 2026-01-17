/// <reference no-default-lib="true" />
/// <reference lib="deno.ns" />
/// <reference lib="dom" />

import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const u = new URL(req.url);
    const target = u.searchParams.get("url") || "";

    if (!target) {
      return new Response(JSON.stringify({ error: "Missing url param" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let tu: URL;
    try {
      tu = new URL(target);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sicherheits-Check: nur Supabase Storage public URLs erlauben
    const isSupabase = tu.hostname.endsWith(".supabase.co");
    const isPublicStorage = tu.pathname.includes("/storage/v1/object/public/");
    if (!isSupabase || !isPublicStorage) {
      return new Response(JSON.stringify({ error: "URL not allowed" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const upstream = await fetch(tu.toString(), {
      redirect: "follow",
      headers: { Accept: "application/pdf,*/*" },
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const buf = await upstream.arrayBuffer();

    // Content-Type absichern
    const ct = upstream.headers.get("content-type") || "application/pdf";

    return new Response(buf, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": ct.includes("pdf") ? ct : "application/pdf",
        "Content-Disposition": 'inline; filename="menu.pdf"',
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
