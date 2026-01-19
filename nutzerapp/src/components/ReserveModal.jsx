// src/components/ReserveModal.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const HISTORY_BASE = "reservationHistory"; // pro User -> reservationHistory:<uid>
const ACTIVE_BASE = "activeReservation"; // pro User -> activeReservation:<uid>

function safeJsonParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export default function ReserveModal({ table, restaurant, onClose }) {
  const navigate = useNavigate();

  const [step, setStep] = useState(1); // 1=ETA, 2=Name, 3=Confirm
  const [eta, setEta] = useState(10);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [err, setErr] = useState("");

  const etaMinutes = useMemo(() => {
    const n = Number(eta);
    if (!Number.isFinite(n)) return 10;
    return Math.max(1, Math.min(20, Math.round(n)));
  }, [eta]);

  const incEta = () => setEta((p) => Math.min(20, Number(p || 1) + 1));
  const decEta = () => setEta((p) => Math.max(1, Number(p || 1) - 1));

  // ✅ Nur Login-Check (KEIN Active-Reservation-Blocking mehr!)
  useEffect(() => {
    let cancelled = false;

    const checkUser = async () => {
      setChecking(true);
      setErr("");

      const { data } = await supabase.auth.getUser();
      const user = data?.user;

      if (cancelled) return;

      if (!user?.id) {
        onClose?.();
        navigate("/login", { replace: true });
        return;
      }

      setChecking(false);
    };

    checkUser();
    return () => {
      cancelled = true;
    };
  }, [navigate, onClose]);

  const goNext = () => {
    setErr("");

    if (step === 1) {
      if (!etaMinutes || etaMinutes < 1 || etaMinutes > 20) {
        setErr("Bitte wähle eine gültige Ankunftszeit.");
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      const n = name.trim();
      if (n.length < 2) {
        setErr("Bitte deinen Namen eingeben.");
        return;
      }
      setStep(3);
    }
  };

  const goBack = () => {
    setErr("");
    setStep((s) => Math.max(1, s - 1));
  };

  const confirm = async () => {
    if (loading) return;

    const { data: u } = await supabase.auth.getUser();
    const user = u?.user;

    if (!user?.id) {
      onClose?.();
      navigate("/login");
      return;
    }

    setLoading(true);
    setErr("");

    try {
      const reservedFor = name.trim();

      const { data: res, error } = await supabase.functions.invoke("reservation-create", {
        body: {
          restaurant_id: restaurant.id,
          table_id: table.id,

          reserved_for: reservedFor,
          eta_minutes: etaMinutes,
          seats: table.seats,

          // redundante Felder (falls Function/Trigger diese nutzt)
          customer_name: reservedFor,
          arrival_minutes: etaMinutes,
        },
      });

      // ❗️WICHTIG: wir blocken NICHT mehr im UI – aber wenn der SERVER noch sperrt,
      // kommt hier evtl. 409 zurück. Dann MUSS die Sperre in der Function raus.
      const statusCode = error?.context?.status;
      if (statusCode === 409 || res?.error === "active_reservation_exists") {
        setErr(
          "Der Server blockiert gerade mehrere aktive Reservierungen (409). Bitte entferne die Sperre in der Supabase Function 'reservation-create'."
        );
        setLoading(false);
        return;
      }

      if (error || !res?.ok) {
        const msg = res?.error || error?.message || "Server-Fehler. Bitte erneut.";
        setErr(msg);
        setLoading(false);
        return;
      }

      // ✅ localStorage: jede Reservierung immer in History speichern
      const uid = user.id;
      const HISTORY_KEY = `${HISTORY_BASE}:${uid}`;
      const ACTIVE_KEY = `${ACTIVE_BASE}:${uid}`; // für Kompatibilität: setzten wir auf "letzte"

      const reservationId = String(res?.reservation_id || "");
      const createdAtMs = Date.now();
      const expiresAtMs = res?.expires_at ? new Date(res.expires_at).getTime() : createdAtMs + 15 * 60 * 1000;

      const item = {
        id: reservationId,
        restaurantName: restaurant.name,
        seats: table.seats,
        reservedFor,
        etaMinutes,
        createdAt: createdAtMs,
        expiresAt: expiresAtMs,
        status: "pending",
      };

      // Optional (Kompatibilität): ACTIVE zeigt nur die letzte, aber History enthält ALLE
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(item));

      const prev = safeJsonParse(localStorage.getItem(HISTORY_KEY), []);
      const arr = Array.isArray(prev) ? prev : [];
      const map = new Map();

      for (const r of arr) {
        if (r?.id) map.set(r.id, r);
      }
      map.set(item.id, item);

      // 30 Tage cleanup
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const cleaned = Array.from(map.values()).filter((r) => {
        const ca = Number(r?.createdAt || 0);
        return ca >= cutoff;
      });

      cleaned.sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(cleaned));

      navigate("/profile");
    } catch (e) {
      setErr(e?.message || "Server-Fehler. Bitte erneut.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl p-6 w-full max-w-sm relative">
        <button onClick={onClose} className="absolute right-4 top-4 text-xl" aria-label="Schließen" type="button">
          ✕
        </button>

        <h2 className="text-xl font-semibold mb-1">Tisch reservieren</h2>
        <div className="text-sm text-[#7A8696] mb-5">
          Tisch für <span className="font-semibold text-[#2E2E2E]">{table.seats}</span> Personen
        </div>

        <div className="flex items-center gap-2 mb-5">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`h-2 flex-1 rounded-full ${step >= s ? "bg-[#6F8F73]" : "bg-[#E7E2D7]"}`} />
          ))}
        </div>

        {checking && (
          <div className="mb-4 bg-[#F8F7F4] text-[#9AA7B8] rounded-2xl p-3 text-sm">Prüfe Login…</div>
        )}

        {err && <div className="mb-4 bg-[#F8F7F4] text-[#9AA7B8] rounded-2xl p-3 text-sm">{err}</div>}

        {step === 1 && (
          <div>
            <div className="font-medium text-[#2E2E2E] mb-3">Ankunft in</div>

            <div className="bg-[#F8F7F4] rounded-3xl p-4 flex items-center justify-between">
              <button
                type="button"
                onClick={decEta}
                disabled={etaMinutes <= 1 || checking}
                className="w-12 h-12 rounded-2xl bg-white shadow-sm text-[#2E2E2E] font-semibold text-2xl disabled:opacity-40"
                aria-label="Weniger Minuten"
              >
                −
              </button>

              <div className="text-center">
                <div className="text-4xl font-semibold text-[#2E2E2E] leading-none">{etaMinutes}</div>
                <div className="text-xs text-[#9AA7B8] mt-1">Minuten</div>
              </div>

              <button
                type="button"
                onClick={incEta}
                disabled={etaMinutes >= 20 || checking}
                className="w-12 h-12 rounded-2xl bg-white shadow-sm text-[#2E2E2E] font-semibold text-2xl disabled:opacity-40"
                aria-label="Mehr Minuten"
              >
                +
              </button>
            </div>

            <button
              onClick={goNext}
              disabled={checking}
              className="w-full mt-5 bg-[#6F8F73] text-white py-3 rounded-xl font-medium disabled:opacity-60"
              type="button"
            >
              Weiter
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="font-medium text-[#2E2E2E] mb-3">Auf welchen Namen reservieren?</div>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Max Mustermann"
              className="w-full bg-[#F8F7F4] rounded-2xl px-4 py-3 outline-none border border-[#E7E2D7]"
            />

            <div className="flex gap-2 mt-5">
              <button type="button" onClick={goBack} className="flex-1 bg-[#F8F7F4] text-[#2E2E2E] py-3 rounded-xl font-medium">
                Zurück
              </button>
              <button type="button" onClick={goNext} className="flex-1 bg-[#6F8F73] text-white py-3 rounded-xl font-medium">
                Weiter
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="bg-[#F8F7F4] rounded-2xl p-4">
              <div className="text-sm text-[#9AA7B8]">Restaurant</div>
              <div className="font-semibold text-[#2E2E2E]">{restaurant.name}</div>

              <div className="mt-3 text-sm text-[#9AA7B8]">Reservierung</div>
              <div className="text-[#2E2E2E]">
                Tisch für <span className="font-semibold">{table.seats}</span> ·{" "}
                <span className="font-semibold">{name.trim()}</span> · Ankunft{" "}
                <span className="font-semibold">{etaMinutes} Min</span>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={goBack}
                disabled={loading}
                className="flex-1 bg-[#F8F7F4] text-[#2E2E2E] py-3 rounded-xl font-medium disabled:opacity-60"
              >
                Zurück
              </button>

              <button
                onClick={confirm}
                disabled={loading}
                className="flex-1 bg-[#6F8F73] text-white py-3 rounded-xl font-medium disabled:opacity-60"
                type="button"
              >
                {loading ? "Wird gesendet…" : "Jetzt verbindlich reservieren"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
