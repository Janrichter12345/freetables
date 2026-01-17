import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/mockApi";

export default function RatingPage() {
  const { reservationId } = useParams();
  const nav = useNavigate();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const { data: reservation } = useQuery({
    queryKey: ["reservation", reservationId],
    queryFn: () => api.getReservation(reservationId),
  });

  const submit = useMutation({
    mutationFn: async () => {
      await api.createReview({
        reservationId,
        restaurantId: reservation.restaurant_id,
        rating,
        comment,
      });
      await api.updateReservation(reservationId, { status: "completed" });
    },
    onSuccess: () => nav("/restaurants"),
  });

  if (!reservation) return <div className="px-4 py-10 text-center">Nicht gefunden</div>;

  return (
    <div className="px-4 py-6 max-w-md mx-auto">
      <div className="bg-white rounded-2xl border border-[#E7E2D7]/40 p-5">
        <h1 className="text-xl font-semibold text-[#2E2E2E]">Bewertung</h1>
        <p className="text-sm text-[#9AA7B8]">{reservation.restaurant_name}</p>

        <div className="mt-5">
          <label className="text-sm font-medium">Sterne (1–5)</label>
          <input
            type="range"
            min="1"
            max="5"
            value={rating}
            onChange={(e) => setRating(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-sm mt-1">Deine Bewertung: <b>{rating}</b></div>
        </div>

        <div className="mt-4">
          <label className="text-sm font-medium">Kommentar (optional)</label>
          <textarea
            className="w-full mt-2 p-3 bg-[#F8F7F4] rounded-xl border border-[#E7E2D7]"
            rows="4"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Wie war dein Besuch?"
          />
        </div>

        <button
          onClick={() => submit.mutate()}
          className="mt-5 w-full bg-[#A8BCA1] text-white py-4 rounded-xl"
        >
          Absenden
        </button>
      </div>
    </div>
  );
}
