import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const config = { verify_jwt: true };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function env(name: string) {
  return (Deno.env.get(name) || "").trim();
}

function decodeJwtSub(authHeader: string | null) {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const payloadB64 = parts[1].replaceAll("-", "+").replaceAll("_", "/");
  const pad = "=".repeat((4 - (payloadB64.length % 4)) % 4);

  try {
    const payloadJson = atob(payloadB64 + pad);
    const payload = JSON.parse(payloadJson);
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_ROLE_KEY = env("SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "missing_env" }, 500);

    const user_id = decodeJwtSub(req.headers.get("Authorization"));
    if (!user_id) return json({ ok: false, error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const idsRaw = Array.isArray(body.reservation_ids) ? body.reservation_ids : [];
    const ids = idsRaw.map((x) => String(x ?? "").trim()).filter(Boolean);
    if (!ids.length) return json({ ok: true, items: [] });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // 1) Hol die Reservierungen (ohne user_filter, weil manche legacy NULL user_id haben)
    const { data: rows, error } = await admin
      .from("reservations")
      .select(
        "id,user_id,status,responded_at,call_status,twilio_call_sid,reserved_for,eta_minutes,seats,table_id,restaurants:restaurant_id(name)"
      )
      .in("id", ids);

    if (error) return json({ ok: false, error: "db_failed", details: error.message }, 500);

    const list = Array.isArray(rows) ? rows : [];

    // 2) Claim: falls user_id NULL -> setze auf aktuellen User (nur für die angefragten ids)
    const toClaim = list.filter((r) => !r.user_id).map((r) => r.id);
    if (toClaim.length > 0) {
      await admin.from("reservations").update({ user_id }).in("id", toClaim);
      // lokale Daten auch anpassen (damit Filter gleich stimmt)
      for (const r of list) {
        if (!r.user_id) r.user_id = user_id;
      }
    }

    // 3) Security: gib nur rows zurück, die dem User gehören
    const items = list.filter((r) => String(r.user_id || "") === user_id);

    return json({ ok: true, items });
  } catch (e) {
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
