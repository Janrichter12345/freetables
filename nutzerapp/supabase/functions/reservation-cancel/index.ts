import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const config = { verify_jwt: true };

const corsHeaders = {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_ROLE_KEY = env("SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      return json({ ok: false, error: "missing_env" }, 500);
    }

    // ✅ eingeloggten User aus JWT holen
    const authHeader = req.headers.get("Authorization") || "";
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: uData, error: uErr } = await authClient.auth.getUser();
    const user = uData?.user;
    if (uErr || !user?.id) return json({ ok: false, error: "unauthorized" }, 401);
    const user_id = user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const reservation_id = String(body.reservation_id || "").trim();
    if (!reservation_id) return json({ ok: false, error: "missing_reservation_id" }, 400);

    const { data: r } = await admin
      .from("reservations")
      .select("id, table_id, status, user_id")
      .eq("id", reservation_id)
      .single();

    if (!r) return json({ ok: false, error: "not_found" }, 404);
    if (String(r.user_id || "") !== user_id) return json({ ok: false, error: "forbidden" }, 403);

    await admin.from("reservations").update({ status: "cancelled" }).eq("id", reservation_id);

    if (r.table_id) {
      await admin.from("tables").update({ status: "frei" }).eq("id", r.table_id);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
