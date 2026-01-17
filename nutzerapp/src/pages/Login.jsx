import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";

export default function LoginPage() {
  const { sendMagicLink } = useAuth();

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setSent(false);

    try {
      await sendMagicLink(email);
      setSent(true);
    } catch (e2) {
      setErr(e2?.message || "Etwas ist schiefgelaufen.");
    }
  };

  return (
    <div className="bg-[#F8F7F4] min-h-full px-5 py-10">
      <div className="bg-white rounded-3xl p-6 shadow-sm max-w-xl mx-auto">
        <div className="text-xl font-semibold text-[#2E2E2E]">Anmelden</div>
        <div className="text-sm text-[#9AA7B8] mt-1">
          Du bekommst einen Link per E-Mail, um dich einzuloggen.
        </div>

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-Mail Adresse"
            className="w-full border border-[#E7E2D7] rounded-xl px-4 py-3 outline-none"
          />

          <button
            type="submit"
            className="w-full bg-[#2E2E2E] text-white rounded-xl py-3 font-semibold"
          >
            Magic Link senden
          </button>

          {err && <div className="text-sm text-red-600">{err}</div>}
          {sent && (
            <div className="text-sm text-[#6F8F73]">
              Link gesendet ✅ Bitte überprüfe dein Postfach (auch Spam).
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
