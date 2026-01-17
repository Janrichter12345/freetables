import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!apiKey) {
      return json(
        {
          ok: false,
          error: "Missing GOOGLE_MAPS_API_KEY (Supabase → Edge Functions → Secrets)",
        },
        500
      );
    }

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const address = typeof body?.address === "string" ? body.address.trim() : "";

    const query = [name, address].filter(Boolean).join(", ").trim();
    if (!query) return json({ ok: false, error: "Missing name/address" }, 400);

    // 1) Find Place (beste Trefferquote)
    const findUrl = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
    findUrl.searchParams.set("input", query);
    findUrl.searchParams.set("inputtype", "textquery");
    findUrl.searchParams.set(
      "fields",
      "place_id,name,formatted_address,rating,user_ratings_total"
    );
    findUrl.searchParams.set("key", apiKey);

    const findRes = await fetch(findUrl.toString());
    const findJson = await findRes.json();

    // Wenn Google “REQUEST_DENIED” etc. liefert, zeigen wir es dir sofort:
    const findStatus = String(findJson?.status ?? "");
    if (findStatus && findStatus !== "OK" && findStatus !== "ZERO_RESULTS") {
      return json({
        ok: false,
        error: "Google Places error",
        status: findStatus,
        message: findJson?.error_message ?? null,
        query,
      }, 400);
    }

    let item =
      Array.isArray(findJson?.candidates) && findJson.candidates.length
        ? findJson.candidates[0]
        : null;

    // 2) Fallback: Text Search (wenn FindPlace nix findet)
    if (!item) {
      const tsUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
      tsUrl.searchParams.set("query", query);
      tsUrl.searchParams.set("key", apiKey);

      const tsRes = await fetch(tsUrl.toString());
      const tsJson = await tsRes.json();

      const tsStatus = String(tsJson?.status ?? "");
      if (tsStatus && tsStatus !== "OK" && tsStatus !== "ZERO_RESULTS") {
        return json({
          ok: false,
          error: "Google Places error",
          status: tsStatus,
          message: tsJson?.error_message ?? null,
          query,
        }, 400);
      }

      item =
        Array.isArray(tsJson?.results) && tsJson.results.length
          ? tsJson.results[0]
          : null;
    }

    if (!item) return json({ ok: true, found: false, query });

    const place_id = item?.place_id ?? null;
    const rating = typeof item?.rating === "number" ? item.rating : null;
    const user_ratings_total =
      typeof item?.user_ratings_total === "number" ? item.user_ratings_total : null;

    return json({
      ok: true,
      found: true,
      query,
      place_id,
      rating,
      user_ratings_total,
      name: item?.name ?? null,
      address: item?.formatted_address ?? item?.formatted_address ?? null,
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
