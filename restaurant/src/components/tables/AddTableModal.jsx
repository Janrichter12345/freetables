import { useState } from "react";

export default function AddTableModal({ onAdd, onClose }) {
  const [name, setName] = useState("");
  const [seats, setSeats] = useState(2);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-[#F8F7F4] w-full sm:max-w-sm sm:rounded-2xl rounded-t-3xl border-t border-[#E7E2D7] sm:border sm:border-[#E7E2D7] shadow-sm max-h-[92vh] overflow-y-auto">
        {/* Mobile handle */}
        <div className="sm:hidden pt-3 pb-2 flex justify-center">
          <div className="w-12 h-1.5 rounded-full bg-[#E7E2D7]" />
        </div>

        {/* Header (sticky) */}
        <div className="sticky top-0 bg-[#F8F7F4] px-5 sm:px-6 pt-2 sm:pt-6 pb-4 border-b border-[#E7E2D7]">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-[#2E2E2E] text-lg sm:text-base">
              Neuen Tisch hinzufügen
            </h2>

            <button
              onClick={onClose}
              className="h-10 w-10 rounded-xl border border-[#E7E2D7] bg-white text-[#2E2E2E] flex items-center justify-center active:scale-[0.98]"
              aria-label="Schließen"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 sm:px-6 py-5 sm:py-6 flex flex-col gap-4">
          <input
            placeholder="Tischname (z. B. Tisch 5)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-[#E7E2D7] rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[#A8BCA1]"
          />

          <div className="flex flex-col gap-2">
            <label className="text-sm text-[#2E2E2E]">Anzahl Personen</label>

            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value))}
              className="border border-[#E7E2D7] rounded-2xl px-4 py-3 text-center text-lg focus:outline-none focus:ring-2 focus:ring-[#A8BCA1]"
            />

            <span className="text-xs text-[#9AA7B8] text-center"></span>
          </div>

          <button
            onClick={() => {
              if (!name || seats < 1) return;
              onAdd({ name, seats });
              onClose();
            }}
            className="bg-[#A8BCA1] text-white py-3.5 rounded-2xl font-medium active:scale-[0.98] touch-manipulation"
          >
            Tisch hinzufügen
          </button>
        </div>
      </div>
    </div>
  );
}
