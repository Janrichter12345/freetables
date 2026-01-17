// supabase/functions/reservation-create/index.ts
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

function decodeJwtSub(authHeader: string | null) {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const payloadB64 = parts[1].replaceAll("-", "+").replaceAll("_", "/");
  const pad = "=".repeat((4 - (payloadB64.length % 4)) % 4);
  const payloadJson = atob(payloadB64 + pad);

  try {
    const payload = JSON.parse(payloadJson);
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function isActiveReservation(r: any, nowMs: number) {
  const st = String(r?.status || "");
  if (st === "pending") {
    const exp = r?.expires_at ? new Date(String(r.expires_at)).getTime() : 0;
    return Number.isFinite(exp) && exp > nowMs;
  }
  if (st === "accepted") {
    // accepted soll noch "aktiv" bleiben (z.B. für Anreise)
    const windowMs = 6 * 60 * 60 * 1000; // 6h (kannst du später anpassen)
    const t =
      (r?.responded_at ? new Date(String(r.responded_at)).getTime() : 0) ||
      (r?.created_at ? new Date(String(r.created_at)).getTime() : 0);
    return Number.isFinite(t) && t > nowMs - windowMs;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_ROLE_KEY = env("SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");

    const TWILIO_SID = env("TWILIO_ACCOUNT_SID");
    const TWILIO_TOKEN = env("TWILIO_AUTH_TOKEN");
    const TWILIO_FROM = env("TWILIO_FROM_NUMBER");
    const WEBHOOK_TOKEN = env("TWILIO_WEBHOOK_TOKEN");
    const TEST_TO_NUMBER = env("TEST_TO_NUMBER");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ ok: false, error: "missing SUPABASE_URL or SERVICE_ROLE_KEY" }, 500);
    }
    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || !WEBHOOK_TOKEN) {
      return json({ ok: false, error: "missing Twilio env vars" }, 500);
    }

    const user_id = decodeJwtSub(req.headers.get("Authorization"));
    if (!user_id) return json({ ok: false, error: "not_authenticated" }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const restaurant_id = String(body.restaurant_id || "").trim();
    const table_id = String(body.table_id || "").trim();
    const reserved_for = String(body.reserved_for || "").trim();
    const eta_minutes = Number(body.eta_minutes);
    const seats = Number(body.seats);

    if (!restaurant_id || !table_id || !reserved_for) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }
    if (!Number.isFinite(eta_minutes) || eta_minutes < 1 || eta_minutes > 20) {
      return json({ ok: false, error: "eta_minutes_must_be_1_to_20" }, 400);
    }
    if (!Number.isFinite(seats) || seats < 1) {
      return json({ ok: false, error: "invalid_seats" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ✅ Schritt 9: globaler Check (pro User nur 1 aktive Reservierung)
    {
      const nowMs = Date.now();
      const { data: candidates } = await admin
        .from("reservations")
        .select("id,status,expires_at,responded_at,created_at,restaurant_id")
        .eq("user_id", user_id)
        .in("status", ["pending", "accepted"])
        .order("created_at", { ascending: false })
        .limit(20);

      const active = (Array.isArray(candidates) ? candidates : []).find((r) => isActiveReservation(r, nowMs));
      if (active) {
        return json(
          { ok: false, error: "active_reservation_exists", active_reservation_id: active.id },
          409
        );
      }
    }

    // 1) Restaurant check + phone
    const { data: rest, error: restErr } = await admin
      .from("restaurants")
      .select("id, name, phone")
      .eq("id", restaurant_id)
      .single();

    if (restErr || !rest) return json({ ok: false, error: "restaurant_not_found" }, 404);

    const to = (TEST_TO_NUMBER || String(rest.phone || "").trim()).trim();
    if (!to) return json({ ok: false, error: "missing_restaurant_phone" }, 400);

    // 2) Atomar blocken: nur wenn frei -> "angefragt"
    const { data: blocked, error: blockErr } = await admin
      .from("tables")
      .update({ status: "angefragt" })
      .eq("id", table_id)
      .eq("status", "frei")
      .select("id, restaurant_id")
      .maybeSingle();

    if (blockErr || !blocked) {
      return json({ ok: false, error: "table_not_available" }, 409);
    }
    if (String(blocked.restaurant_id) !== restaurant_id) {
      await admin.from("tables").update({ status: "frei" }).eq("id", table_id);
      return json({ ok: false, error: "table_not_in_restaurant" }, 400);
    }

    // 3) Reservation anlegen (pending) ✅ user_id setzen
    const expiresAtIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { data: created, error: insErr } = await admin
      .from("reservations")
      .insert({
        restaurant_id,
        table_id,
        reserved_for,
        eta_minutes,
        seats,
        status: "pending",
        expires_at: expiresAtIso,
        user_id,
      })
      .select("id, expires_at")
      .single();

    if (insErr || !created?.id) {
      await admin.from("tables").update({ status: "frei" }).eq("id", table_id);
      return json({ ok: false, error: insErr?.message || "reservation_insert_failed" }, 500);
    }

    const reservation_id = String(created.id);

    // 4) Twilio Call starten
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

    const raw = await callRes.text().catch(() => "");
    let callJson: Record<string, unknown> | null = null;
    try {
      callJson = raw ? JSON.parse(raw) : null;
    } catch {
      callJson = null;
    }

    if (!callRes.ok) {
      await admin.from("reservations").update({ status: "failed" }).eq("id", reservation_id);
      await admin.from("tables").update({ status: "frei" }).eq("id", table_id);
      return json({ ok: false, error: "twilio_call_failed", details: callJson ?? raw }, 500);
    }

    const callSid = callJson?.sid ? String(callJson.sid) : null;
    const callStatus = callJson?.status ? String(callJson.status) : null;

    await admin
      .from("reservations")
      .update({ twilio_call_sid: callSid, call_status: callStatus })
      .eq("id", reservation_id);

    return json({
      ok: true,
      reservation_id,
      expires_at: created.expires_at,
      callSid,
      to,
    });
  } catch (e) {
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
