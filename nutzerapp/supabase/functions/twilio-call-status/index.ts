import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const config = { verify_jwt: false };

function env(name: string) {
  return (Deno.env.get(name) || "").trim();
}

const ok = () => new Response("ok", { status: 200 });

Deno.serve(async (req) => {
  try {
    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_ROLE_KEY = env("SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
    const WEBHOOK_TOKEN = env("TWILIO_WEBHOOK_TOKEN");

    const url = new URL(req.url);
    const token = (url.searchParams.get("token") || "").trim();
    const reservation_id = (url.searchParams.get("reservation_id") || "").trim();

    // Immer 200 an Twilio, sonst "Application error"
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !WEBHOOK_TOKEN) return ok();
    if (!token || token !== WEBHOOK_TOKEN || !reservation_id) return ok();

    const body = await req.text().catch(() => "");
    const form = new URLSearchParams(body);

    const callStatus = (form.get("CallStatus") || "").trim(); // completed, no-answer, busy, failed, canceled...
    const callSid = (form.get("CallSid") || "").trim();

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: r } = await admin
      .from("reservations")
      .select("id, table_id, status, responded_at")
      .eq("id", reservation_id)
      .maybeSingle();

    // call meta immer speichern
    await admin
      .from("reservations")
      .update({ call_status: callStatus || null, twilio_call_sid: callSid || null })
      .eq("id", reservation_id);

    if (!r) return ok();

    // Wenn schon entschieden -> nix überschreiben
    if (r.responded_at || r.status === "accepted" || r.status === "declined" || r.status === "no_response") {
      return ok();
    }

    const failStatuses = new Set(["busy", "failed", "no-answer", "canceled"]);
    if (failStatuses.has(callStatus)) {
      await admin
        .from("reservations")
        .update({ status: "failed", responded_at: new Date().toISOString() })
        .eq("id", reservation_id);

      if (r.table_id) await admin.from("tables").update({ status: "frei" }).eq("id", r.table_id);
      return ok();
    }

    // Call zu Ende, aber niemand hat gedrückt -> no_response + Tisch frei
    if (callStatus === "completed") {
      await admin
        .from("reservations")
        .update({ status: "no_response", responded_at: new Date().toISOString() })
        .eq("id", reservation_id);

      if (r.table_id) await admin.from("tables").update({ status: "frei" }).eq("id", r.table_id);
    }

    return ok();
  } catch {
    return ok();
  }
});
