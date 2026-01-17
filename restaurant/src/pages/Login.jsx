// src/pages/Login.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import logo from "../assets/logo.png";

const RESTAURANT_ID = "31391688-5672-4801-8691-3e3d15ac3e6a";
const AUTOCOMPLETE_LIMIT = 3;

// ✅ Partner läuft unter /partner (Routing-Basis)
const PARTNER_BASE = "/partner";

// ✅ Fixe Prod-URL (Vercel ENV), sonst local/dev fallback
function getPartnerOrigin() {
  const envUrl = import.meta.env.VITE_PARTNER_APP_URL;
  if (envUrl) return String(envUrl).replace(/\/+$/, "");
  if (import.meta.env.DEV) return "http://localhost:5174";
  return window.location.origin;
}

function isEmail(v) {
  const s = String(v || "").trim();
  return s.includes("@") && s.includes(".");
}

function cleanPhone(v) {
  return String(v || "").replace(/[^\d+ ]/g, "").trim();
}

function buildCompactAddress(item) {
  const a = item?.address || {};
  const road = a.road || a.pedestrian || a.footway || a.cycleway || "";
  const house = a.house_number || "";
  const postcode = a.postcode || "";
  const city = a.city || a.town || a.village || a.hamlet || "";
  const part1 = [road, house].filter(Boolean).join(" ").trim();
  const part2 = [postcode, city].filter(Boolean).join(" ").trim();
  const out = [part1, part2].filter(Boolean).join(", ").trim();
  return out || String(item?.display_name || "").split(",").slice(0, 2).join(", ").trim();
}

async function nominatimSearch(q) {
  const query = String(q || "").trim();
  if (!query) return [];

  const withAustria = /österreich|austria|\bat\b/i.test(query) ? query : `${query}, Österreich`;

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=${AUTOCOMPLETE_LIMIT}&countrycodes=at&q=${encodeURIComponent(
    withAustria
  )}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", "Accept-Language": "de" },
  });
  if (!res.ok) return [];

  const json = await res.json();
  const arr = Array.isArray(json) ? json : [];

  if (arr.length === 0) {
    const tokens = query.split(/\s+/).map((t) => t.trim()).filter(Boolean);
    if (tokens.length >= 2) {
      const alt = `${tokens.sort((a, b) => a.localeCompare(b)).join(" ")}, Österreich`;
      const url2 = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=${AUTOCOMPLETE_LIMIT}&countrycodes=at&q=${encodeURIComponent(
        alt
      )}`;

      const res2 = await fetch(url2, {
        headers: { Accept: "application/json", "Accept-Language": "de" },
      });
      if (!res2.ok) return [];

      const json2 = await res2.json();
      const arr2 = Array.isArray(json2) ? json2 : [];

      return arr2.map((it) => ({
        label: buildCompactAddress(it),
        lat: Number(it.lat),
        lng: Number(it.lon),
      }));
    }
  }

  return arr.map((it) => ({
    label: buildCompactAddress(it),
    lat: Number(it.lat),
    lng: Number(it.lon),
  }));
}

export default function Login() {
  const navigate = useNavigate();

  // Registrierung
  const [rName, setRName] = useState("");
  const [rAddress, setRAddress] = useState("");
  const [rPhone, setRPhone] = useState("");
  const [rWebsite, setRWebsite] = useState("");
  const [rEmail, setREmail] = useState("");

  // Login (bereits Partner)
  const [loginOpen, setLoginOpen] = useState(false);
  const [lEmail, setLEmail] = useState("");

  // UI
  const [sendingReg, setSendingReg] = useState(false);
  const [sendingLogin, setSendingLogin] = useState(false);
  const [regMsg, setRegMsg] = useState("");
  const [regErr, setRegErr] = useState("");
  const [loginMsg, setLoginMsg] = useState("");
  const [loginErr, setLoginErr] = useState("");

  const [regSubmitted, setRegSubmitted] = useState(false);
  const [loginSubmitted, setLoginSubmitted] = useState(false);

  // Address autocomplete
  const [addrOpen, setAddrOpen] = useState(false);
  const [addrLoading, setAddrLoading] = useState(false);
  const [addrItems, setAddrItems] = useState([]);
  const [addrPick, setAddrPick] = useState(null);
  const addrBoxRef = useRef(null);

  // Auth session
  const [session, setSession] = useState(null);
  const userEmail = useMemo(() => session?.user?.email || "", [session]);

  // ✅ Redirect ist IMMER Prod-URL (oder dev), nicht “random localhost”
  const redirectTo = useMemo(() => {
    const origin = getPartnerOrigin();
    return new URL(`${PARTNER_BASE}/`, origin).toString();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        // ✅ URL säubern (auf /partner/)
        window.history.replaceState({}, "", `${PARTNER_BASE}/`);
        if (error) console.warn("exchangeCodeForSession:", error);
      }

      const { data } = await supabase.auth.getSession();
      if (!cancelled) setSession(data?.session || null);

      const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
        setSession(newSession || null);
      });

      return () => sub?.subscription?.unsubscribe?.();
    };

    let unsub;
    run().then((fn) => (unsub = fn));

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  useEffect(() => {
    if (!session?.user?.email) return;
    try {
      localStorage.setItem("ft_restaurant_id", RESTAURANT_ID);
    } catch {}
    navigate("/dashboard");
  }, [session, navigate]);

  useEffect(() => {
    let active = true;
    const q = String(rAddress || "").trim();

    if (!addrOpen || q.length < 3) {
      setAddrItems([]);
      setAddrLoading(false);
      return;
    }

    setAddrLoading(true);
    const t = setTimeout(async () => {
      const items = await nominatimSearch(q);
      if (!active) return;
      setAddrItems(items.slice(0, AUTOCOMPLETE_LIMIT));
      setAddrLoading(false);
    }, 250);

    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [rAddress, addrOpen]);

  useEffect(() => {
    const onDown = (e) => {
      const el = addrBoxRef.current;
      if (!el) return;
      if (!el.contains(e.target)) setAddrOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const sendMagicLink = async (mail, setMsg, setErr, setSending) => {
    setErr("");
    setMsg("");

    const email = String(mail || "").trim().toLowerCase();
    if (!isEmail(email)) {
      setErr("Bitte gültige E-Mail eingeben.");
      return false;
    }

    setSending(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: true,
        },
      });
      if (error) throw error;

      setMsg("✅ Link gesendet. E-Mail bestätigen.");
      return true;
    } catch (e) {
      setErr(e?.message || "Link konnte nicht gesendet werden.");
      return false;
    } finally {
      setSending(false);
    }
  };

  const requiredBorder = (bad) => (bad ? "border-red-500 bg-red-50" : "border-[#E7E2D7] bg-[#F8F7F4]");

  const regNameBad = regSubmitted && !String(rName || "").trim();
  const regAddrBad = regSubmitted && !String(rAddress || "").trim();
  const regEmailBad = regSubmitted && !isEmail(rEmail);
  const loginEmailBad = loginSubmitted && !isEmail(lEmail);

  const register = async () => {
    setRegSubmitted(true);
    setRegErr("");
    setRegMsg("");

    const name = String(rName || "").trim();
    const address = String(rAddress || "").trim();
    const phone = cleanPhone(rPhone);
    const website = String(rWebsite || "").trim();
    const email = String(rEmail || "").trim().toLowerCase();

    if (!name || !address || !isEmail(email)) {
      setRegErr("Bitte Pflichtfelder ausfüllen.");
      return;
    }

    setSendingReg(true);
    try {
      let lat = addrPick?.lat ?? null;
      let lng = addrPick?.lng ?? null;

      if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
        const items = await nominatimSearch(address);
        const best = items?.[0] || null;
        lat = best?.lat ?? null;
        lng = best?.lng ?? null;
      }

      if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
        setRegErr("Adresse nicht gefunden. Bitte Vorschlag auswählen.");
        return;
      }

      const payload = {
        id: RESTAURANT_ID,
        name,
        address,
        phone: phone || null,
        website: website || null,
        email,
        lat,
        lng,
      };

      const { error } = await supabase.from("restaurants").upsert(payload, { onConflict: "id" });
      if (error) throw error;

      try {
        localStorage.setItem("ft_restaurant_id", RESTAURANT_ID);
      } catch {}

      await sendMagicLink(email, setRegMsg, setRegErr, setSendingReg);
      setLoginOpen(false);
    } catch (e) {
      setRegErr(e?.message || "Speichern fehlgeschlagen.");
    } finally {
      setSendingReg(false);
    }
  };

  const loginExisting = async () => {
    setLoginSubmitted(true);
    setLoginErr("");
    setLoginMsg("");

    const email = String(lEmail || "").trim().toLowerCase();
    if (!isEmail(email)) {
      setLoginErr("Bitte gültige E-Mail eingeben.");
      return;
    }

    setSendingLogin(true);
    try {
      const { data, error } = await supabase.from("restaurants").select("email").eq("id", RESTAURANT_ID).maybeSingle();
      if (error) console.warn(error);

      const stored = String(data?.email || "").trim().toLowerCase();
      if (!stored) {
        setLoginErr("Noch nicht registriert – bitte zuerst registrieren.");
        return;
      }
      if (stored !== email) {
        setLoginErr("Diese E-Mail passt nicht zu deinem Partnerprofil.");
        return;
      }

      await sendMagicLink(email, setLoginMsg, setLoginErr, setSendingLogin);
    } finally {
      setSendingLogin(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      <header className="bg-white border-b border-[#E7E2D7] sticky top-0 z-50">
        <div className="flex items-center justify-between px-4 h-16 max-w-6xl mx-auto">
          <img src={logo} alt="Free Tables" className="h-12 w-auto" />
        </div>
      </header>

      <div className="px-4 sm:px-6 py-6">
        <div
          className="max-w-6xl mx-auto rounded-3xl border border-[#E7E2D7] overflow-hidden"
          style={{
            background:
              "radial-gradient(900px 420px at 30% 30%, rgba(168,188,161,0.35), rgba(248,247,244,1) 60%), radial-gradient(700px 320px at 80% 20%, rgba(111,143,115,0.18), rgba(248,247,244,1) 55%)",
          }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-5 sm:p-8 lg:p-10">
            <div className="flex flex-col justify-center">
              <h1 className="text-3xl sm:text-5xl font-semibold text-[#2E2E2E] leading-tight">
                Freie Tische
                <br />
                schneller füllen
              </h1>

              <p className="mt-3 text-sm sm:text-base text-[#7A8696] max-w-xl">Mehr Laufkundschaft, weniger Leerstand.</p>

              <div className="mt-5 grid gap-2 text-sm text-[#2E2E2E]">
                <Bullet>Mehr Sichtbarkeit in der Nähe</Bullet>
                <Bullet>Reservierungen klar & übersichtlich</Bullet>
                <Bullet>Profil später erweiterbar (Fotos, Speisekarte)</Bullet>
              </div>

              {userEmail ? (
                <div className="mt-6 inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/70 border border-[#E7E2D7] text-sm text-[#2E2E2E] w-fit">
                  Eingeloggt als <span className="font-semibold break-all">{userEmail}</span>
                </div>
              ) : null}
            </div>

            <div className="lg:flex lg:justify-end">
              <div className="w-full max-w-md bg-white rounded-3xl border border-[#E7E2D7] p-5 sm:p-6 shadow-sm">
                <div className="font-semibold text-[#2E2E2E] text-lg">Start</div>
                <div className="text-sm text-[#9AA7B8] mt-1">Pflicht: Restaurantname, Adresse, E-Mail.</div>

                <form
                  autoComplete="off"
                  onSubmit={(e) => {
                    e.preventDefault();
                    register();
                  }}
                  className="mt-5 grid gap-3"
                >
                  <Field label="Restaurantname" required>
                    <input
                      value={rName}
                      onChange={(e) => setRName(e.target.value)}
                      placeholder="z.B. La Strada"
                      className={`w-full border rounded-2xl px-4 py-3 outline-none ${requiredBorder(regNameBad)}`}
                      name="ft_partner_register_name"
                    />
                  </Field>

                  <Field label="Adresse" required>
                    <div ref={addrBoxRef} className="relative">
                      <input
                        value={rAddress}
                        onChange={(e) => {
                          setRAddress(e.target.value);
                          setAddrPick(null);
                        }}
                        onFocus={() => setAddrOpen(true)}
                        placeholder="z.B. Kellergasse 13, 3130 Herzogenburg"
                        className={`w-full border rounded-2xl px-4 py-3 outline-none ${requiredBorder(regAddrBad)}`}
                        name="ft_partner_register_address"
                        autoComplete="off"
                      />

                      {addrOpen && (addrLoading || addrItems.length > 0) && (
                        <div className="absolute z-30 left-0 right-0 mt-2 bg-white border border-[#E7E2D7] rounded-2xl shadow-sm overflow-hidden">
                          <div className="max-h-40 overflow-auto">
                            {addrLoading && <div className="px-4 py-3 text-sm text-[#9AA7B8]">Suche…</div>}

                            {!addrLoading &&
                              addrItems.map((it, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => {
                                    setRAddress(it.label);
                                    setAddrPick({ lat: it.lat, lng: it.lng, label: it.label });
                                    setAddrOpen(false);
                                  }}
                                  className="w-full text-left px-4 py-3 text-sm hover:bg-[#F8F7F4] text-[#2E2E2E]"
                                >
                                  {it.label}
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </Field>

                  <Field label="Telefon">
                    <input
                      value={rPhone}
                      onChange={(e) => setRPhone(e.target.value)}
                      placeholder="+43 …"
                      className="w-full bg-[#F8F7F4] border border-[#E7E2D7] rounded-2xl px-4 py-3 outline-none"
                      name="ft_partner_register_phone"
                      autoComplete="off"
                    />
                  </Field>

                  <Field label="Webseite">
                    <input
                      value={rWebsite}
                      onChange={(e) => setRWebsite(e.target.value)}
                      placeholder="https://…"
                      className="w-full bg-[#F8F7F4] border border-[#E7E2D7] rounded-2xl px-4 py-3 outline-none"
                      name="ft_partner_register_website"
                      autoComplete="off"
                    />
                  </Field>

                  <Field label="E-Mail" required>
                    <input
                      value={rEmail}
                      onChange={(e) => setREmail(e.target.value)}
                      placeholder="restaurant@domain.at"
                      className={`w-full border rounded-2xl px-4 py-3 outline-none ${requiredBorder(regEmailBad)}`}
                      name="ft_partner_register_email"
                      inputMode="email"
                      autoComplete="off"
                    />
                  </Field>

                  {regErr && <div className="text-sm text-red-600">{regErr}</div>}
                  {regMsg && <div className="text-sm text-[#6F8F73]">{regMsg}</div>}

                  <button
                    type="submit"
                    disabled={sendingReg}
                    className="w-full bg-[#6F8F73] hover:bg-[#5f7f66] disabled:opacity-60 text-white py-3 rounded-2xl font-semibold transition active:scale-[0.98]"
                  >
                    {sendingReg ? "Sende…" : "Registrieren"}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => {
                    setLoginOpen((p) => !p);
                    setLoginErr("");
                    setLoginMsg("");
                    setLoginSubmitted(false);
                  }}
                  className="mt-3 w-full bg-white border border-[#E7E2D7] text-[#2E2E2E] py-3 rounded-2xl font-semibold transition active:scale-[0.98]"
                >
                  Bereits Partner?
                </button>

                {loginOpen && (
                  <form
                    autoComplete="off"
                    onSubmit={(e) => {
                      e.preventDefault();
                      loginExisting();
                    }}
                    className="mt-3 bg-[#F8F7F4] border border-[#E7E2D7] rounded-2xl p-4"
                  >
                    <div className="font-semibold text-[#2E2E2E]">Wieder einloggen</div>

                    <div className="mt-3">
                      <div className="text-xs font-semibold text-[#2E2E2E] mb-1">E-Mail</div>
                      <input
                        value={lEmail}
                        onChange={(e) => setLEmail(e.target.value)}
                        placeholder="restaurant@domain.at"
                        className={`w-full border rounded-2xl px-4 py-3 outline-none ${requiredBorder(loginEmailBad)}`}
                        name="ft_partner_login_email"
                        inputMode="email"
                        autoComplete="off"
                      />
                    </div>

                    {loginErr && <div className="mt-2 text-sm text-red-600">{loginErr}</div>}
                    {loginMsg && <div className="mt-2 text-sm text-[#6F8F73]">{loginMsg}</div>}

                    <button
                      type="submit"
                      disabled={sendingLogin}
                      className="mt-3 w-full bg-white border border-[#E7E2D7] text-[#2E2E2E] py-3 rounded-2xl font-semibold transition active:scale-[0.98] disabled:opacity-60"
                    >
                      {sendingLogin ? "Sende…" : "Login-Link senden"}
                    </button>
                  </form>
                )}

                <div className="mt-3 text-xs text-[#9AA7B8] leading-relaxed">Nach dem Bestätigen bleibst du eingeloggt.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-10 pb-14">
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-semibold text-[#2E2E2E]">Warum FreeTables?</div>
            <div className="text-sm text-[#9AA7B8] mt-1">Schneller Einstieg – sofort auffindbar.</div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <WhyCard title="Mehr Laufkundschaft">Gäste in der Nähe sehen dich sofort.</WhyCard>
            <WhyCard title="Schneller Überblick">Freie Tische & Status klar sichtbar.</WhyCard>
            <WhyCard title="Profil wächst mit">Fotos/PDF kannst du später ergänzen.</WhyCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bullet({ children }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-[6px] w-2 h-2 rounded-full bg-[#6F8F73]" />
      <div className="text-[#2E2E2E]">{children}</div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <div className="text-xs font-semibold text-[#2E2E2E] mb-1">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </div>
      {children}
    </div>
  );
}

function WhyCard({ title, children }) {
  return (
    <div className="bg-white rounded-3xl border border-[#E7E2D7] p-5 sm:p-6">
      <div className="font-semibold text-[#2E2E2E]">{title}</div>
      <div className="text-sm text-[#7A8696] mt-2">{children}</div>
    </div>
  );
}
