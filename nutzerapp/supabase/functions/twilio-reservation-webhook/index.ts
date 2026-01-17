import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const config = { verify_jwt: false };

const LANG = "de-DE";
const VOICE = "Polly.Vicki"; // stabil
const FUNCTION_NAME = "twilio-reservation-webhook";

function twiml(xml: string) {
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function esc(s: string) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function env(name: string) {
  return (Deno.env.get(name) || "").trim();
}

// ✅ Digits aus Query ODER (bei POST) aus Body lesen
async function readDigits(req: Request, url: URL) {
  const q = (url.searchParams.get("Digits") || url.searchParams.get("digits") || "").trim();
  if (q) return q;

  if (req.method !== "POST") return "";

  const body = await req.text().catch(() => "");
  if (!body) return "";

  const form = new URLSearchParams(body);
  return (form.get("Digits") || form.get("digits") || "").trim();
}

// 👉 Say mit SSML erlauben (kein esc() im Inhalt, damit <lang>, <break>, <emphasis> wirken)
function sayLine(text: string) {
  return `<Say language="${LANG}" voice="${VOICE}">${text}</Say>`;
}

function gather(actionUrl: string, lines: string[]) {
  const inner = lines
    .map((l, i) => (i === 0 ? "" : `<Pause length="1"/>`) + sayLine(l))
    .join("");

  // ✅ WICHTIG: method="POST" (kein 401-Drama bei GET)
  return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Gather input="dtmf" numDigits="1" timeout="8" actionOnEmptyResult="true" action="${esc(
    actionUrl
  )}" method="POST">
    ${inner}
  </Gather>
  ${sayLine(`Keine Eingabe erhalten.<break time="600ms"/> Auf Wiederhören.`)}
  <Hangup/>
</Response>`);
}

function hangup() {
  return twiml(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
}

function functionsOriginFromSupabaseUrl(SUPABASE_URL: string) {
  try {
    const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
    if (!projectRef) return null;
    return `https://${projectRef}.functions.supabase.co`;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_ROLE_KEY = env("SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
    const WEBHOOK_TOKEN = env("TWILIO_WEBHOOK_TOKEN");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !WEBHOOK_TOKEN) return hangup();

    const url = new URL(req.url);
    const token = (url.searchParams.get("token") || "").trim();
    const reservation_id = (url.searchParams.get("reservation_id") || "").trim();
    const stage = (url.searchParams.get("stage") || "").trim(); // "" | "a1" | "a2"

    if (!token || token !== WEBHOOK_TOKEN || !reservation_id) return hangup();

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: r } = await admin
      .from("reservations")
      .select("id, table_id, reserved_for, eta_minutes, seats, status, responded_at")
      .eq("id", reservation_id)
      .maybeSingle();

    if (!r) {
      return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${sayLine(`Technischer Fehler.<break time="600ms"/> Bitte versuchen Sie es später erneut.`)}
  <Hangup/>
</Response>`);
    }

    // Schon entschieden? Dann nichts mehr ändern.
    if (r.responded_at || r.status === "accepted" || r.status === "declined" || r.status === "no_response") {
      return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${sayLine(`Diese Anfrage wurde bereits verarbeitet.<break time="500ms"/> Vielen Dank.`)}
  <Hangup/>
</Response>`);
    }

    const reservedFor = r.reserved_for ? String(r.reserved_for) : "ein Gast";
    const seats = r.seats ? String(r.seats) : "mehrere";
    const eta = r.eta_minutes ? String(r.eta_minutes) : "einigen";

    // ✅ Action-URLs IMMER über functions.supabase.co bauen (stabil)
    const fOrigin = functionsOriginFromSupabaseUrl(SUPABASE_URL) || url.origin;
    const base =
      `${fOrigin}/${FUNCTION_NAME}` +
      `?token=${encodeURIComponent(token)}` +
      `&reservation_id=${encodeURIComponent(reservation_id)}`;

    // ===== 1) Start =====
    if (!stage) {
      const actionUrl = `${base}&stage=a1`;

      return gather(actionUrl, [
        // „Free Tables“ bewusst als englischer Block
        `Hallo, hier ist <lang xml:lang="en-US">Free Tables</lang>.`,
        `${reservedFor} möchte einen Tisch für ${seats} Personen reservieren.`,
        `Die voraussichtliche Ankunft ist in ungefähr ${eta} Minuten.`,
        `Drücken Sie jetzt die <emphasis level="moderate">1</emphasis> zum Bestätigen.`,
        `Oder drücken Sie die <emphasis level="moderate">2</emphasis> zum Ablehnen.`,
      ]);
    }

    // ===== 2) a1 =====
    if (stage === "a1") {
      const digits = await readDigits(req, url);

      if (digits === "1" || digits === "2") {
        const newStatus: "accepted" | "declined" = digits === "1" ? "accepted" : "declined";

        await admin
          .from("reservations")
          .update({ status: newStatus, responded_at: new Date().toISOString() })
          .eq("id", reservation_id);

        if (r.table_id) {
          const tableStatus = newStatus === "accepted" ? "reserviert" : "frei";
          await admin.from("tables").update({ status: tableStatus }).eq("id", r.table_id);
        }

        return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${
    newStatus === "accepted"
      ? sayLine(`Danke.<break time="400ms"/> Die Reservierung wurde bestätigt.`)
      : sayLine(`Alles klar.<break time="400ms"/> Die Reservierung wurde abgelehnt.`)
  }
  <Hangup/>
</Response>`);
      }

      // zweite Chance
      const actionUrl = `${base}&stage=a2`;
      return gather(actionUrl, [
        `Kurzer Hinweis.<break time="500ms"/>`,
        `Bitte drücken Sie nur <emphasis level="strong">1</emphasis> oder <emphasis level="strong">2</emphasis>.`,
        `Die <emphasis level="moderate">1</emphasis> bedeutet Ja.`,
        `Die <emphasis level="moderate">2</emphasis> bedeutet Nein.`,
      ]);
    }

    // ===== 3) a2 (letzte Chance) =====
    const digits = await readDigits(req, url);

    let newStatus: "accepted" | "declined" | "no_response" = "no_response";
    if (digits === "1") newStatus = "accepted";
    else if (digits === "2") newStatus = "declined";

    await admin
      .from("reservations")
      .update({ status: newStatus, responded_at: new Date().toISOString() })
      .eq("id", reservation_id);

    if (r.table_id) {
      const tableStatus = newStatus === "accepted" ? "reserviert" : "frei";
      await admin.from("tables").update({ status: tableStatus }).eq("id", r.table_id);
    }

    return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${
    newStatus === "accepted"
      ? sayLine(`Danke.<break time="400ms"/> Die Reservierung wurde bestätigt.`)
      : newStatus === "declined"
      ? sayLine(`Alles klar.<break time="400ms"/> Die Reservierung wurde abgelehnt.`)
      : sayLine(`Keine gültige Eingabe erhalten.<break time="600ms"/> Die Anfrage wird beendet.`)
  }
  <Hangup/>
</Response>`);
  } catch {
    return hangup();
  }
});
