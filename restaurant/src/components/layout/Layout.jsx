// src/components/layout/Layout.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import logo from "../../assets/logo.png";
import { supabase } from "../../lib/supabase";

const PARTNER_COOKIE = "ft_partner";

const LS_REST_ID = "ft_partner_restaurant_id";
const LS_REST_NAME = "ft_partner_restaurant_name";
const EVT_REST_CHANGED = "ft:partner_restaurant_changed";

function setPartnerCookie(isOn) {
  try {
    if (isOn) {
      document.cookie = `${PARTNER_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax`;
    } else {
      document.cookie = `${PARTNER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    }
  } catch {
    // ignore
  }
}

function readCachedRestaurantName() {
  try {
    return localStorage.getItem(LS_REST_NAME) || "";
  } catch {
    return "";
  }
}

function clearRestaurantCache() {
  try {
    localStorage.removeItem(LS_REST_ID);
    localStorage.removeItem(LS_REST_NAME);
    window.dispatchEvent(new Event(EVT_REST_CHANGED));
  } catch {
    // ignore
  }
}

export default function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  // ✅ robust: funktioniert egal ob du /partner als Base hast oder nicht
  const basePath = useMemo(() => {
    return location.pathname.startsWith("/partner") ? "/partner" : "";
  }, [location.pathname]);

  const [userOpen, setUserOpen] = useState(false);
  const [session, setSession] = useState(null);

  const [restaurantName, setRestaurantName] = useState(() => readCachedRestaurantName());

  // ✅ Restaurantname im Header nachziehen (auch nach Refresh)
  useEffect(() => {
    const read = () => setRestaurantName(readCachedRestaurantName());

    read();
    const onStorage = (e) => {
      if (e.key === LS_REST_NAME) read();
    };

    window.addEventListener(EVT_REST_CHANGED, read);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(EVT_REST_CHANGED, read);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // ✅ Session sicher re-hydraten (Refresh-fest) + Cookie setzen
  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const sess = data?.session || null;
      setSession(sess);
      setPartnerCookie(!!sess);
      if (!sess) clearRestaurantCache();
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess || null);
      setPartnerCookie(!!sess);
      if (!sess) clearRestaurantCache();
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const userEmail = session?.user?.email || "";
  const displayName = userEmail ? userEmail.split("@")[0] : "Partner";

  const initials = useMemo(() => {
    const s = String(displayName || "").trim();
    if (!s) return "U";
    const parts = s
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "U";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }, [displayName]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("Logout failed:", e);
    } finally {
      setPartnerCookie(false);
      clearRestaurantCache();
      setUserOpen(false);
      window.location.assign(`${basePath}/`);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      <header className="bg-white border-b border-[#E7E2D7] sticky top-0 z-50">
        <div className="flex items-center justify-between px-4 h-16">
          <img src={logo} alt="Free Tables" className="h-12 w-auto" />

          <div className="flex items-center gap-4 relative">
            {/* ✅ Glocke weg */}

            <button
              onClick={() => setUserOpen((p) => !p)}
              className="flex items-center gap-3"
              type="button"
            >
              <div className="w-9 h-9 rounded-full bg-[#A8BCA1] flex items-center justify-center text-white text-sm font-semibold">
                {initials}
              </div>

              <div className="hidden sm:block text-left">
                <div className="text-sm font-semibold text-[#2E2E2E]">
                  {userEmail || "Partner"}
                </div>
                <div className="text-xs text-[#9AA7B8]">
                  Restaurant · {restaurantName || "—"}
                </div>
              </div>
            </button>

            {userOpen && (
              <div className="absolute right-0 top-14 bg-white border border-[#E7E2D7] rounded-xl w-72 shadow-lg z-50">
                <button
                  onClick={() => setUserOpen(false)}
                  className="absolute top-2 right-2 text-[#9AA7B8]"
                  type="button"
                >
                  ✕
                </button>

                <div className="p-4 border-b border-[#E7E2D7]">
                  <div className="font-semibold text-[#2E2E2E]">
                    {restaurantName || "Restaurant"}
                  </div>
                  <div className="text-sm text-[#9AA7B8]">
                    {userEmail || "Nicht angemeldet"}
                  </div>
                </div>

                <button
                  onClick={() => {
                    setUserOpen(false);
                    navigate(`${basePath}/restaurant-details`);
                  }}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-[#F8F7F4]"
                  type="button"
                >
                  🏪 Restaurant Details
                </button>

                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-[#F8F7F4]"
                  type="button"
                >
                  ↩ Abmelden
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="p-4">{children}</main>
    </div>
  );
}
