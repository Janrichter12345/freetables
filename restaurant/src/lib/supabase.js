import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://qecvmlzxgnhywtsphrzw.supabase.co";
const supabaseAnonKey = "sb_publishable_vBIhaqZtl6PkP9TKD-ykkw_ICkJAKt6";

export const PARTNER_META_KEY = "ft_partner_meta";
export const PARTNER_STORAGE_KEY = "ft_restaurant_auth";

// ✅ eigener storageKey => keine Kollision mit User-App
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: PARTNER_STORAGE_KEY,
  },
});

// ✅ BRIDGE: User-App kann jetzt zuverlässig erkennen ob Partner eingeloggt ist
function writePartnerMeta(session) {
  try {
    if (session?.access_token) {
      localStorage.setItem(
        PARTNER_META_KEY,
        JSON.stringify({
          active: true,
          expires_at: session.expires_at ?? null, // unix seconds
          updated_at: Date.now(),
        })
      );
    } else {
      localStorage.removeItem(PARTNER_META_KEY);
    }
  } catch {}
}

// ✅ nur 1x installieren
if (!globalThis.__ft_partner_bridge_installed) {
  globalThis.__ft_partner_bridge_installed = true;

  supabase.auth.getSession().then(({ data }) => {
    writePartnerMeta(data?.session || null);
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    writePartnerMeta(session || null);
  });
}
