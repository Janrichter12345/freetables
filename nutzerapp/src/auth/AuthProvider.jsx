import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

// Base-Path automatisch aus Vite (normal "/" bei nutzerapp)
function getAppBasePath() {
  const base = String(import.meta.env.BASE_URL || "/");
  let out = base.startsWith("/") ? base : `/${base}`;
  out = out.replace(/\/+$/, "") + "/";
  if (out === "//") out = "/";
  return out;
}

// Für DEV -> localhost:5173, für PROD -> window.origin oder ENV
function getUserAppOrigin() {
  const envUrl = import.meta.env.VITE_USER_APP_URL; // optional: https://freetables.vercel.app
  if (envUrl) return String(envUrl).replace(/\/+$/, "");
  if (import.meta.env.DEV) return "http://localhost:5173";
  return window.location.origin;
}

// Redirect URL für Magic Link (muss bei Supabase als Redirect URL erlaubt sein!)
function buildMagicLinkRedirectUrl() {
  const origin = getUserAppOrigin();
  const base = getAppBasePath();
  // Wir schicken IMMER auf /auth/callback (Route muss existieren)
  return new URL(`${base}auth/callback`, origin).toString();
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const user = session?.user || null;

  useEffect(() => {
    let alive = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;

      setSession(data?.session || null);
      setLoading(false);

      const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
        setSession(newSession || null);
      });

      return () => sub?.subscription?.unsubscribe?.();
    };

    let unsub;
    init().then((fn) => (unsub = fn));

    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  const sendMagicLink = async (emailRaw) => {
    const email = String(emailRaw || "").trim().toLowerCase();
    if (!email || !email.includes("@")) throw new Error("Bitte gültige E-Mail eingeben.");

    const redirectTo = buildMagicLinkRedirectUrl();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: true,
      },
    });

    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      sendMagicLink,
      signOut,
    }),
    [user, session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
