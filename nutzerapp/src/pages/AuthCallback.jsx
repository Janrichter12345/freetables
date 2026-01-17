import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallbackPage() {
  const nav = useNavigate();
  const [msg, setMsg] = useState("Du wirst eingeloggt…");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        // robust: wenn code im URL -> Session austauschen
        const url = window.location.href;
        const hasCode = new URL(url).searchParams.get("code");
        if (hasCode) {
          const { error } = await supabase.auth.exchangeCodeForSession(url);
          if (error) throw error;
        }

        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error("Keine Session gefunden.");

        const dest = localStorage.getItem("postLoginRedirect") || "/profile";
        localStorage.removeItem("postLoginRedirect");

        if (!cancelled) nav(dest, { replace: true });
      } catch (e) {
        if (!cancelled) setMsg(e?.message || "Login fehlgeschlagen.");
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [nav]);

  return (
    <div className="bg-[#F8F7F4] min-h-full px-5 py-10">
      <div className="bg-white rounded-3xl p-6 shadow-sm max-w-xl mx-auto text-center text-[#7A8696]">
        {msg}
      </div>
    </div>
  );
}
