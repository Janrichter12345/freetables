// src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Check your .env and restart dev server."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,           // ✅ Session merken
    autoRefreshToken: true,         // ✅ Token automatisch erneuern
    detectSessionInUrl: true,       // ✅ Magic-Link (E-Mail) aus URL lesen
    storage: window.localStorage,   // ✅ explizit LocalStorage nutzen
    storageKey: "ft-user-session",  // ✅ eigener Key für die Nutzer-App
  },
});
