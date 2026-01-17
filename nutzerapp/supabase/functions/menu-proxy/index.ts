// supabase/functions/menu-proxy/index.ts
// Public PDF proxy: fixes CORS + forces inline display (and supports Range).

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type, content-disposition",
};

function filenameFromPath(path: string) {
  const name = (path.split("/").pop() || "menu.pdf").trim();
  return name || "menu.pdf";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const u = new URL(req.url);
    const bucket = (u.searchParams.get("bucket") || "").trim();
    const path = (u.searchParams.get("path") || "").trim();

    // ✅ Safety: only allow your bucket
    if (!bucket || bucket !== "restaurant-menus" || !path) {
      return new Response("Bad request", { status: 400, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) {
      return new Response("Missing SUPABASE_URL", { status: 500, headers: corsHeaders });
    }

    // Public object URL
    const storageUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;

    // Forward Range if present (some viewers request partial content)
    const range = req.headers.get("range");
    const upstream = await fetch(storageUrl, {
      headers: range ? { range } : undefined,
    });

    if (!upstream.ok || !upstream.body) {
      return new Response("Not found", { status: upstream.status || 404, headers: corsHeaders });
    }

    const headers = new Headers(corsHeaders);

    // Content-Type: keep upstream if it already is pdf, otherwise force pdf
    const ct = upstream.headers.get("content-type") || "";
    headers.set("Content-Type", ct.includes("pdf") ? ct : "application/pdf");

    // ✅ Force inline display
    const fn = filenameFromPath(path);
    headers.set("Content-Disposition", `inline; filename="${fn}"`);

    // Pass-through useful headers (for proper rendering)
    const cr = upstream.headers.get("content-range");
    if (cr) headers.set("Content-Range", cr);

    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("Content-Length", cl);

    const ar = upstream.headers.get("accept-ranges");
    if (ar) headers.set("Accept-Ranges", ar);

    // Optional caching
    headers.set("Cache-Control", upstream.headers.get("cache-control") || "public, max-age=3600");

    return new Response(upstream.body, {
      status: upstream.status, // keep 200/206 etc.
      headers,
    });
  } catch {
    return new Response("Server error", { status: 500, headers: corsHeaders });
  }
});
