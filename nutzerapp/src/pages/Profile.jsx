// src/pages/Profile.jsx (oder wo deine Datei liegt)
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";

const HISTORY_BASE = "reservationHistory";
const ACTIVE_BASE = "activeReservation";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const PARTNER_PORTAL_URL = import.meta.env.DEV
  ? "http://localhost:5174/partner/"
  : "/partner/";

// (localStorage fallback – hilft nur wenn gleicher Origin)
const PARTNER_STORAGE_KEY = "ft_restaurant_auth";

// ✅ Cookie, das die Partner-App setzt
const PARTNER_COOKIE = "ft_partner";

function hasPartnerCookie() {
  try {
    return document.cookie.split("; ").some((c) => c === `${PARTNER_COOKIE}=1`);
  } catch {
    return false;
  }
}

function hasActivePartnerSession() {
  // ✅ 1) Cookie funktioniert auch über 5173/5174
  if (hasPartnerCookie()) return true;

  // ✅ 2) Fallback: localStorage (nur wenn gleicher Origin)
  try {
    const raw = localStorage.getItem(PARTNER_STORAGE_KEY);
    if (!raw) return false;

    const obj = JSON.parse(raw);
    const sess = obj?.session || obj?.currentSession || obj;
    const token = sess?.access_token || obj?.access_token || null;
    if (!token) return false;

    const exp = sess?.expires_at ?? obj?.expires_at ?? null;

    if (typeof exp === "number") {
      if (exp * 1000 <= Date.now()) return false;
    } else if (typeof exp === "string") {
      const t = Date.parse(exp);
      if (Number.isFinite(t) && t <= Date.now()) return false;
    }

    return true;
  } catch {
    return false;
  }
}

function statusLabel(status) {
  const s = String(status || "pending");
  if (s === "pending") return "Bestätigung ausstehend";
  if (s === "accepted") return "Bestätigt";
  if (s === "declined") return "Abgelehnt";
  if (s === "no_response") return "Keine Antwort";
  if (s === "failed") return "Fehlgeschlagen";
  if (s === "cancelled") return "Abgebrochen";
  return s;
}

function statusPillClass(status) {
  const s = String(status || "pending");
  if (s === "accepted") return "bg-[#6F8F73]/15 text-[#6F8F73]";
  if (s === "pending") return "bg-[#9AA7B8]/15 text-[#7A8696]";
  if (s === "declined") return "bg-red-500/10 text-red-600";
  if (s === "failed") return "bg-red-500/10 text-red-600";
  if (s === "no_response") return "bg-[#9AA7B8]/20 text-[#7A8696]";
  if (s === "cancelled") return "bg-[#9AA7B8]/20 text-[#7A8696]";
  return "bg-[#9AA7B8]/15 text-[#7A8696]";
}

function safeJsonParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function parseFlexibleDate(input) {
  if (input === null || input === undefined || input === "") return null;

  if (typeof input === "number" && Number.isFinite(input)) {
    const d0 = new Date(input);
    if (!Number.isNaN(d0.getTime())) return d0;
  }

  const d1 = new Date(input);
  if (!Number.isNaN(d1.getTime())) return d1;

  const m = String(input).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    const year = Number(m[3]);
    const hour = Number(m[4] || 0);
    const minute = Number(m[5] || 0);
    const d2 = new Date(year, month, day, hour, minute, 0);
    if (!Number.isNaN(d2.getTime())) return d2;
  }

  return null;
}

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatGroupDate(d) {
  if (!d) return "Unbekanntes Datum";
  return d.toLocaleDateString("de-CH", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function dateKey(d) {
  if (!d) return "unknown";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function statusHint(status) {
  const s = String(status || "");
  if (s === "no_response") {
    return "Dein Restaurant war vermutlich gerade beschäftigt und konnte nicht reagieren. Bitte reserviere in ein paar Minuten erneut.";
  }
  if (s === "failed") {
    return "Das hat leider nicht geklappt. Bitte versuche es gleich noch einmal.";
  }
  return null;
}

function normName(s) {
  return String(s || "").trim().toLowerCase();
}

function basisTimeMs(r) {
  const t = parseFlexibleDate(r?.reservedFor)?.getTime?.();
  if (typeof t === "number" && !Number.isNaN(t)) return t;
  const c = Number(r?.createdAt || 0);
  return Number.isFinite(c) ? c : 0;
}

function acceptedAtMs(r) {
  const t = parseFlexibleDate(r?.acceptedAt)?.getTime?.();
  if (typeof t === "number" && !Number.isNaN(t)) return t;
  return null;
}

function pickAcceptedTimeFromDb(db) {
  const raw =
    db?.accepted_at ??
    db?.acceptedAt ??
    db?.status_updated_at ??
    db?.statusUpdatedAt ??
    db?.responded_at ??
    db?.respondedAt ??
    db?.updated_at ??
    db?.updatedAt ??
    null;

  const t = parseFlexibleDate(raw)?.getTime?.();
  return typeof t === "number" && !Number.isNaN(t) ? t : null;
}

function displayWhen(r) {
  const d =
    parseFlexibleDate(r?.reservedFor) ||
    parseFlexibleDate(r?.acceptedAt) ||
    (Number.isFinite(Number(r?.createdAt)) ? new Date(Number(r.createdAt)) : null);

  if (!d) return r?.reservedFor ? String(r.reservedFor) : "";
  return d.toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function slotKey(r) {
  const name = normName(r?.restaurantName);
  if (!name) return null;

  const rf = parseFlexibleDate(r?.reservedFor);
  let t = rf?.getTime?.();
  if (typeof t !== "number" || Number.isNaN(t)) t = Number(r?.createdAt || 0);

  const seats = r?.seats != null ? String(r.seats) : "";
  if (!Number.isFinite(t) || t <= 0) return `${name}|unknown|${seats}`;

  const Q = 5 * 60 * 1000;
  const rounded = Math.round(t / Q) * Q;

  return `${name}|${rounded}|${seats}`;
}

function dedupeBySlot(items) {
  const best = new Map();

  for (const r of items) {
    if (!r?.id) continue;

    const key = slotKey(r) || r.id;
    const st = String(r?.status || "pending");

    const isAcc = st === "accepted";
    const tAcc = acceptedAtMs(r) ?? 0;
    const tBasis = basisTimeMs(r) ?? 0;

    const score = (isAcc ? 1_000_000_000_000 : 0) + Math.max(tAcc, tBasis);

    const cur = best.get(key);
    if (!cur || score > (cur._score || 0)) best.set(key, { ...r, _score: score });
  }

  return Array.from(best.values()).map(({ _score, ...rest }) => rest);
}

export default function ProfilePage() {
  const { user, signOut, loading } = useAuth();
  const email = user?.email || "";
  const initials = (email?.split("@")?.[0] || "U").slice(0, 2).toUpperCase();
  const emailWrap = useMemo(() => (email ? email.replace("@", "@\u200B") : ""), [email]);

  const uid = user?.id || null;
  const HISTORY_KEY = uid ? `${HISTORY_BASE}:${uid}` : HISTORY_BASE;
  const ACTIVE_KEY = uid ? `${ACTIVE_BASE}:${uid}` : ACTIVE_BASE;

  const [history, setHistory] = useState([]);
  const [dbMap, setDbMap] = useState({});
  const [statusApiError, setStatusApiError] = useState("");

  // ✅ Partner-Button Zustand
  const [partnerAuthed, setPartnerAuthed] = useState(false);

  useEffect(() => {
    const refresh = () => setPartnerAuthed(hasActivePartnerSession());
    refresh();

    // Cookie ändert sich nicht via "storage" event → Fokus/Visibility ist wichtig
    const onFocus = () => refresh();
    const onVis = () => {
      if (!document.hidden) refresh();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const openPartnerPortal = () => {
    setPartnerAuthed(hasActivePartnerSession());
    try {
      window.open(PARTNER_PORTAL_URL, "_blank", "noopener,noreferrer");
    } catch {
      window.location.href = PARTNER_PORTAL_URL;
    }
  };

  if (loading) {
    return (
      <div className="bg-[#F8F7F4] min-h-full px-4 sm:px-5 py-4 sm:py-6">
        <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-sm text-center text-[#9AA7B8]">
          Lädt…
        </div>
      </div>
    );
  }

  if (!user || !uid) {
    return (
      <div className="bg-[#F8F7F4] min-h-full px-4 sm:px-5 py-4 sm:py-6">
        <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-sm text-center text-[#9AA7B8]">
          Bitte anmelden.
        </div>
      </div>
    );
  }

  // ======= ab hier ist dein Code unverändert (History, Polling, UI, etc.) =======

  useEffect(() => {
    const legacyActive = safeJsonParse(localStorage.getItem(ACTIVE_BASE), null);
    const legacyHistory = safeJsonParse(localStorage.getItem(HISTORY_BASE), []);

    const scopedActiveExisting = safeJsonParse(localStorage.getItem(ACTIVE_KEY), null);
    const scopedHistoryExisting = safeJsonParse(localStorage.getItem(HISTORY_KEY), []);

    if (!scopedActiveExisting && legacyActive?.id) {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(legacyActive));
      localStorage.removeItem(ACTIVE_BASE);
    }
    if (
      (!Array.isArray(scopedHistoryExisting) || scopedHistoryExisting.length === 0) &&
      Array.isArray(legacyHistory) &&
      legacyHistory.length > 0
    ) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(legacyHistory));
      localStorage.removeItem(HISTORY_BASE);
    }

    const active = safeJsonParse(localStorage.getItem(ACTIVE_KEY), null);
    const stored = safeJsonParse(localStorage.getItem(HISTORY_KEY), []);

    const now = Date.now();
    const cutoff = now - THIRTY_DAYS_MS;

    const byId = new Map();

    const add = (r) => {
      if (!r?.id) return;
      const existing = byId.get(r.id) || {};
      byId.set(r.id, {
        ...existing,
        ...r,
        createdAt: existing.createdAt ?? r.createdAt ?? now,
        acceptedAt: existing.acceptedAt ?? r.acceptedAt ?? null,
      });
    };

    (Array.isArray(stored) ? stored : []).forEach(add);
    if (active?.id) add(active);

    const latestByRestaurant = new Map();
    for (const [id, r] of byId.entries()) {
      const name = normName(r?.restaurantName);
      if (!name) continue;
      const t = basisTimeMs(r);
      const cur = latestByRestaurant.get(name);
      if (!cur || t > cur.t) latestByRestaurant.set(name, { id, t });
    }
    for (const [id, r] of byId.entries()) {
      const name = normName(r?.restaurantName);
      if (!name) continue;
      const st = String(r?.status || "");
      if (st !== "no_response") continue;
      const latest = latestByRestaurant.get(name);
      if (latest && latest.id !== id) byId.delete(id);
    }

    let cleaned = Array.from(byId.values()).filter((r) => {
      const createdAt = Number(r.createdAt || 0);
      const reservedForMs = parseFlexibleDate(r.reservedFor)?.getTime?.() ?? null;
      const accMs = acceptedAtMs(r);

      if (createdAt >= cutoff) return true;
      if (reservedForMs != null && reservedForMs >= cutoff) return true;
      if (accMs != null && accMs >= cutoff) return true;
      if (reservedForMs != null && reservedForMs > now) return true;
      return false;
    });

    cleaned = dedupeBySlot(cleaned);
    cleaned.sort((a, b) => basisTimeMs(b) - basisTimeMs(a));

    localStorage.setItem(HISTORY_KEY, JSON.stringify(cleaned));
    setHistory(cleaned);
  }, [ACTIVE_KEY, HISTORY_KEY]);

  useEffect(() => {
    let cancelled = false;

    const ids = history.map((r) => r?.id).filter(Boolean);
    if (ids.length === 0) {
      setDbMap({});
      return;
    }

    const load = async () => {
      setStatusApiError("");

      const { data: sData } = await supabase.auth.getSession();
      const token = sData?.session?.access_token;

      const { data, error } = await supabase.functions.invoke("reservation-status", {
        body: { reservation_ids: ids },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (cancelled) return;

      if (error || !data?.ok) {
        console.warn("reservation-status error:", error || data);
        const code = error?.context?.status || null;
        if (code === 401) setStatusApiError("Session abgelaufen – bitte einmal ausloggen und wieder einloggen.");
        else setStatusApiError("Status konnte nicht geladen werden (Functions).");
        return;
      }

      const items = Array.isArray(data.items) ? data.items : [];
      const next = {};
      for (const item of items) {
        if (item?.id) next[item.id] = item;
      }
      setDbMap(next);
    };

    load();
    const t = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [history]);

  useEffect(() => {
    const declinedIds = new Set(
      Object.values(dbMap || {})
        .filter((it) => String(it?.status || "") === "declined")
        .map((it) => it.id)
        .filter(Boolean)
    );

    if (declinedIds.size === 0) return;

    const nextHistory = history.filter((r) => !declinedIds.has(r?.id));
    if (nextHistory.length !== history.length) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
      setHistory(nextHistory);
    }

    const active = safeJsonParse(localStorage.getItem(ACTIVE_KEY), null);
    if (active?.id && declinedIds.has(active.id)) {
      localStorage.removeItem(ACTIVE_KEY);
    }
  }, [dbMap, history, ACTIVE_KEY, HISTORY_KEY]);

  useEffect(() => {
    if (!history.length) return;

    const now = Date.now();
    let changed = false;

    const enriched = history.map((r) => {
      const db = dbMap?.[r.id] || null;

      const nextStatus = db?.status ?? r.status ?? "pending";
      const restaurantName = db?.restaurants?.name || r.restaurantName || "Restaurant";
      const reservedFor = db?.reserved_for ?? r.reservedFor;
      const seats = db?.seats ?? r.seats;
      const etaMinutes = db?.eta_minutes ?? r.etaMinutes;

      let acceptedAt = r.acceptedAt ?? null;

      if (String(nextStatus) === "accepted") {
        if (!acceptedAtMs({ acceptedAt })) {
          const dbT = pickAcceptedTimeFromDb(db);
          acceptedAt = dbT ?? now;
          changed = true;
        }
      }

      if (String(r.status || "") !== String(nextStatus || "")) changed = true;

      return {
        ...r,
        status: nextStatus,
        restaurantName,
        reservedFor,
        seats,
        etaMinutes,
        acceptedAt,
      };
    });

    const deduped = dedupeBySlot(enriched);

    const cutoff = now - THIRTY_DAYS_MS;
    const cleaned = deduped.filter((r) => {
      const createdAt = Number(r.createdAt || 0);
      const reservedForMs = parseFlexibleDate(r.reservedFor)?.getTime?.() ?? null;
      const accMs = acceptedAtMs(r);

      if (createdAt >= cutoff) return true;
      if (reservedForMs != null && reservedForMs >= cutoff) return true;
      if (accMs != null && accMs >= cutoff) return true;
      if (reservedForMs != null && reservedForMs > now) return true;
      return false;
    });

    const sig = (arr) =>
      JSON.stringify(
        (arr || [])
          .map((x) => ({
            id: x.id,
            status: x.status,
            acceptedAt: x.acceptedAt || null,
            restaurantName: x.restaurantName || null,
            reservedFor: x.reservedFor || null,
            seats: x.seats ?? null,
          }))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      );

    if (changed || sig(cleaned) !== sig(history)) {
      cleaned.sort((a, b) => basisTimeMs(b) - basisTimeMs(a));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(cleaned));
      setHistory(cleaned);
    }

    const active = safeJsonParse(localStorage.getItem(ACTIVE_KEY), null);
    if (active?.id) {
      const db = dbMap?.[active.id] || null;
      const st = String(db?.status ?? active.status ?? "");
      if (st === "accepted") {
        const existingAcc = acceptedAtMs(active);
        if (!existingAcc) {
          const t = pickAcceptedTimeFromDb(db) ?? now;
          localStorage.setItem(ACTIVE_KEY, JSON.stringify({ ...active, status: "accepted", acceptedAt: t }));
        }
      }
    }
  }, [dbMap, history, HISTORY_KEY, ACTIVE_KEY]);

  const mergedReservations = useMemo(() => {
    return history
      .filter((r) => r?.id)
      .map((r) => {
        const db = dbMap?.[r.id] || null;
        return {
          id: r.id,
          restaurantName: db?.restaurants?.name || r.restaurantName || "Restaurant",
          seats: db?.seats ?? r.seats,
          reservedFor: db?.reserved_for ?? r.reservedFor,
          etaMinutes: db?.eta_minutes ?? r.etaMinutes,
          status: db?.status ?? r.status ?? "pending",
          createdAt: r.createdAt,
          acceptedAt: r.acceptedAt ?? null,
        };
      })
      .filter((r) => String(r.status || "") !== "declined");
  }, [history, dbMap]);

  const today = new Date();

  const { current, olderAccepted } = useMemo(() => {
    const now = Date.now();

    const c = [];
    const older = [];

    for (const r of mergedReservations) {
      const rf = parseFlexibleDate(r.reservedFor);
      const basis = rf || (r.createdAt ? new Date(Number(r.createdAt)) : null);

      const isToday = basis ? isSameLocalDay(basis, today) : false;

      if (String(r.status || "") === "accepted") {
        const acc = acceptedAtMs(r) ?? Number(r.createdAt || 0);
        const isActive2h = acc ? now - acc < TWO_HOURS_MS : false;

        if (isToday && isActive2h) c.push(r);
        else older.push(r);
        continue;
      }

      if (isToday) c.push(r);
    }

    c.sort((a, b) => basisTimeMs(a) - basisTimeMs(b));
    older.sort((a, b) => basisTimeMs(b) - basisTimeMs(a));

    const acceptedOnly = older.filter((r) => String(r.status || "") === "accepted");
    return { current: c, olderAccepted: acceptedOnly };
  }, [mergedReservations]);

  const olderGroups = useMemo(() => {
    const map = new Map();

    for (const r of olderAccepted) {
      const rf = parseFlexibleDate(r.reservedFor);
      const basis = rf || (r.createdAt ? new Date(Number(r.createdAt)) : null);
      const key = dateKey(basis);

      if (!map.has(key)) map.set(key, { key, date: basis, items: [] });
      map.get(key).items.push({ ...r, _basis: basis });
    }

    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      if (a.key === "unknown" && b.key === "unknown") return 0;
      if (a.key === "unknown") return 1;
      if (b.key === "unknown") return -1;
      return (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0);
    });

    for (const g of arr) {
      g.items.sort((x, y) => (y._basis?.getTime?.() ?? 0) - (x._basis?.getTime?.() ?? 0));
    }

    return arr;
  }, [olderAccepted]);

  const ReservationCard = ({ r }) => {
    const when = displayWhen(r);

    const parts = [
      r.seats != null ? `Tisch für ${r.seats}` : null,
      when ? `${when}` : null,
      r.etaMinutes != null && r.etaMinutes !== "" ? `Ankunft ${r.etaMinutes} Min` : null,
    ].filter(Boolean);

    const hint = statusHint(r.status);

    return (
      <div className="bg-white rounded-2xl sm:rounded-3xl px-4 py-3 sm:px-5 sm:py-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-[#2E2E2E] mb-1 text-sm sm:text-base truncate">
              {r.restaurantName}
            </div>
            {parts.length > 0 && (
              <div className="text-[11px] sm:text-xs text-[#9AA7B8] break-words leading-snug">
                {parts.join(" · ")}
              </div>
            )}
          </div>

          <div
            className={`shrink-0 self-center px-3 py-1 rounded-full text-[11px] sm:text-xs font-semibold ${statusPillClass(
              r.status
            )}`}
          >
            {statusLabel(r.status)}
          </div>
        </div>

        {hint && <div className="mt-2 text-[11px] sm:text-xs text-[#7A8696] leading-snug">{hint}</div>}
      </div>
    );
  };

  return (
    <div className="bg-[#F8F7F4] min-h-full px-4 sm:px-5 py-4 sm:py-6">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="bg-white rounded-2xl sm:rounded-3xl px-4 py-3 sm:px-5 sm:py-4 shadow-sm mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-11 h-11 sm:w-12 sm:h-12 bg-[#A8BCA1] rounded-full flex items-center justify-center text-white text-base sm:text-lg font-semibold shrink-0">
              {initials}
            </div>

            <div className="min-w-0 flex-1">
              <div
                className="font-semibold text-[#2E2E2E] text-sm sm:text-base break-words leading-tight"
                title={email}
              >
                {emailWrap || "Eingeloggt"}
              </div>
              <div className="text-[11px] sm:text-xs text-[#9AA7B8] leading-tight">Account</div>
            </div>
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={openPartnerPortal}
              className="h-10 inline-flex items-center justify-center bg-[#6F8F73] hover:bg-[#5f7f66] text-white px-5 rounded-2xl text-[12px] sm:text-sm font-semibold leading-none shadow-sm active:scale-[0.98]"
            >
              {partnerAuthed ? "Partner-Zugang" : "Jetzt Partner werden"}
            </button>

            <button
              onClick={signOut}
              className="h-10 inline-flex items-center justify-center border border-[#E7E2D7] px-4 rounded-2xl text-[#7A8696] text-[12px] sm:text-sm leading-none bg-white"
            >
              Logout
            </button>
          </div>
        </div>

        {statusApiError && (
          <div className="bg-white rounded-2xl p-3 mb-3 text-sm text-red-600 shadow-sm">
            {statusApiError}
          </div>
        )}

        <div className="mb-3">
          <div className="font-semibold text-[#2E2E2E] text-base">Reservierungen</div>
        </div>

        {mergedReservations.length === 0 && (
          <div className="bg-white rounded-2xl p-5 text-center text-[#9AA7B8] text-sm shadow-sm">
            Keine Reservierungen vorhanden
          </div>
        )}

        {mergedReservations.length > 0 && (
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-[#2E2E2E] text-sm">Aktuelle Reservierungen</div>
              </div>

              {current.length === 0 ? (
                <div className="bg-white rounded-2xl p-4 text-center text-[#9AA7B8] text-sm shadow-sm">
                  Keine aktuellen Reservierungen
                </div>
              ) : (
                <div className="space-y-3">
                  {current.map((r) => (
                    <ReservationCard key={r.id} r={r} />
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-end justify-between mb-1">
                <div className="font-semibold text-[#2E2E2E] text-sm">Vergangene Reservierungen</div>
              </div>

              <div className="text-[11px] sm:text-xs text-[#9AA7B8] mb-3 leading-snug">
                Bestätigte Reservierungen werden bis zu 30 Tage gespeichert.
              </div>

              {olderAccepted.length === 0 ? (
                <div className="bg-white rounded-2xl p-4 text-center text-[#9AA7B8] text-sm shadow-sm">
                  Keine vergangenen Reservierungen
                </div>
              ) : (
                <div className="space-y-5">
                  {olderGroups.map((g) => (
                    <div key={g.key}>
                      <div className="text-[11px] sm:text-xs font-semibold text-[#2E2E2E] mb-2">
                        {g.key === "unknown" ? "Unbekanntes Datum" : formatGroupDate(g.date)}
                      </div>
                      <div className="space-y-3">
                        {g.items.map((r) => (
                          <ReservationCard key={r.id} r={r} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
