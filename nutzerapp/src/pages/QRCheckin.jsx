import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/mockApi";
import QRCode from "../components/reservation/QRCode";

export default function QRCheckinPage() {
  const { reservationId } = useParams();
  const nav = useNavigate();
  const [timeLeft, setTimeLeft] = useState(null);
  const [expired, setExpired] = useState(false);

  const { data: reservation, isLoading } = useQuery({
    queryKey: ["reservation", reservationId],
    queryFn: () => api.getReservation(reservationId),
  });

  const checkIn = useMutation({
    mutationFn: () => api.updateReservation(reservationId, { status: "checked_in" }),
    onSuccess: () => nav(`/rating/${reservationId}`),
  });

  useEffect(() => {
    if (!reservation?.expires_at) return;

    const tick = () => {
      const now = new Date();
      const exp = new Date(reservation.expires_at);
      const diff = exp - now;

      if (diff <= 0) {
        setExpired(true);
        setTimeLeft(null);
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft({ m, s });
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [reservation?.expires_at]);

  if (isLoading) return <div className="px-4 py-10 text-center text-[#9AA7B8]">Lade…</div>;
  if (!reservation) return <div className="px-4 py-10 text-center">Reservierung nicht gefunden</div>;

  return (
    <div className="px-4 py-6 max-w-md mx-auto">
      <div className="bg-white rounded-3xl border border-[#E7E2D7]/40 overflow-hidden">
        <div className="p-6 text-center">
          <div className="text-lg font-semibold">{reservation.restaurant_name}</div>
          <div className="text-sm text-[#9AA7B8]">Zeige den QR-Code beim Eintritt</div>

          {!expired && timeLeft && (
            <div className="mt-4 inline-block bg-[#F8F7F4] px-4 py-2 rounded-full font-mono">
              {String(timeLeft.m).padStart(2, "0")}:{String(timeLeft.s).padStart(2, "0")}
            </div>
          )}

          <div className={`mt-6 inline-block ${expired ? "opacity-30 grayscale" : ""}`}>
            <QRCode value={reservation.qr_code} size={220} />
          </div>

          <div className="mt-3 text-xs text-[#9AA7B8] font-mono">{reservation.qr_code}</div>
        </div>

        <div className="p-4 border-t border-[#E7E2D7] bg-[#F8F7F4]/40">
          {!expired && reservation.status !== "checked_in" && (
            <button
              onClick={() => checkIn.mutate()}
              className="w-full bg-[#A8BCA1] text-white py-4 rounded-xl"
            >
              Check-In simulieren
            </button>
          )}

          {expired && (
            <button
              onClick={() => nav("/restaurants")}
              className="w-full border border-[#E7E2D7] bg-white py-4 rounded-xl"
            >
              Neue Reservierung
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
