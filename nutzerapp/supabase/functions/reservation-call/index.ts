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

function functionsBaseFromSupabaseUrl(supabaseUrl: string) {
  const host = new URL(supabaseUrl).hostname;
  const projectRef = host.split(".")[0];
  return `https://${projectRef}.functions.supabase.co`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_ROLE_KEY = env("SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");

    const TWILIO_SID = env("TWILIO_ACCOUNT_SID");
    const TWILIO_TOKEN = env("TWILIO_AUTH_TOKEN");
    const TWILIO_FROM = env("TWILIO_FROM_NUMBER");
    const WEBHOOK_TOKEN = env("TWILIO_WEBHOOK_TOKEN");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      return json({ ok: false, error: "missing_SUPABASE_env" }, 500);
    }
    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || !WEBHOOK_TOKEN) {
      return json({ ok: false, error: "missing_Twilio_env_vars" }, 500);
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

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const reservation_id = String(body.reservation_id || "").trim();
    if (!reservation_id) return json({ ok: false, error: "missing_reservation_id" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: r, error: rErr } = await admin
      .from("reservations")
      .select("id, restaurant_id, user_id")
      .eq("id", reservation_id)
      .single();

    if (rErr || !r) return json({ ok: false, error: "reservation_not_found" }, 404);
    if (String(r.user_id || "") !== user_id) return json({ ok: false, error: "forbidden" }, 403);

    const { data: rest, error: restErr } = await admin
      .from("restaurants")
      .select("id, phone")
      .eq("id", r.restaurant_id)
      .single();

    if (restErr || !rest) return json({ ok: false, error: "restaurant_not_found" }, 404);

    const to = String(rest.phone || "").trim();
    if (!to) return json({ ok: false, error: "restaurant_phone_missing" }, 400);

    const functionsBase = functionsBaseFromSupabaseUrl(SUPABASE_URL);

    const voiceUrl =
      `${functionsBase}/twilio-reservation-webhook` +
      `?token=${encodeURIComponent(WEBHOOK_TOKEN)}` +
      `&reservation_id=${encodeURIComponent(reservation_id)}`;

    const statusUrl =
      `${functionsBase}/twilio-call-status` +
      `?token=${encodeURIComponent(WEBHOOK_TOKEN)}` +
      `&reservation_id=${encodeURIComponent(reservation_id)}`;

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls.json`;

    const form = new URLSearchParams();
    form.set("To", to);
    form.set("From", TWILIO_FROM);
    form.set("Url", voiceUrl);
    form.set("Method", "POST");

    form.set("StatusCallback", statusUrl);
    form.set("StatusCallbackMethod", "POST");
    form.set("StatusCallbackEvent", "completed");

    const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
    const callRes = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const callJson = await callRes.json().catch(() => null);
    if (!callRes.ok) return json({ ok: false, error: "twilio_call_failed", details: callJson }, 500);

    const callSid = callJson?.sid ? String(callJson.sid) : null;

    await admin
      .from("reservations")
      .update({ twilio_call_sid: callSid, call_status: callJson?.status ?? null })
      .eq("id", reservation_id);

    return json({ ok: true, callSid });
  } catch (e) {
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
