import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

function getAppBasePath() {
  const base = String(import.meta.env.BASE_URL || "/");
  let out = base.startsWith("/") ? base : `/${base}`;
  out = out.replace(/\/+$/, "") + "/";
  if (out === "//") out = "/";
  return out;
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;

    const run = async () => {
      try {
        const url = window.location.href;

        // Wenn Supabase einen Fehler zurückgibt
        const params = new URLSearchParams(window.location.search);
        const e = params.get("error_description") || params.get("error");
        if (e) throw new Error(e);

        // ✅ Session aus dem Code holen (PKCE)
        const { error } = await supabase.auth.exchangeCodeForSession(url);
        if (error) throw error;

        // ✅ URL sauber machen
        const base = getAppBasePath();
        window.history.replaceState({}, "", base);

        // ✅ Weiter in die App
        navigate("/", { replace: true });
      } catch (e2) {
        if (!alive) return;
        setErr(e2?.message || "Login fehlgeschlagen.");
      }
    };

    run();

    return () => {
      alive = false;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#F8F7F4] px-5 py-10">
      <div className="bg-white rounded-3xl p-6 shadow-sm max-w-xl mx-auto">
        <div className="text-xl font-semibold text-[#2E2E2E]">Login wird abgeschlossen…</div>
        <div className="text-sm text-[#9AA7B8] mt-2">Bitte kurz warten.</div>

        {err && (
          <div className="mt-4 text-sm text-red-600">
            {err}
            <div className="mt-2">
              <button
                className="px-4 py-2 rounded-xl bg-[#2E2E2E] text-white font-semibold"
                onClick={() => navigate("/login", { replace: true })}
              >
                Zurück zum Login
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
