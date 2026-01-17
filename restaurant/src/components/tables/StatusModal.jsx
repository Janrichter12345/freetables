export default function StatusModal({ onClose }) {
  // Aktuell keine neuen Reservierungen
  const reservations = [];

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
              Reservierungen
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
        <div className="px-5 sm:px-6 py-5 sm:py-6">
          {reservations.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">📭</div>
              <p className="text-[#2E2E2E] font-medium">
                Keine neuen Reservierungen
              </p>
              <p className="text-sm text-[#9AA7B8] mt-1 leading-relaxed">
                Aktuell sind keine neuen Reservierungen eingegangen.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {reservations.map((r, index) => (
                <div
                  key={index}
                  className="bg-white border border-[#E7E2D7] rounded-2xl p-4"
                >
                  <p className="font-medium text-[#2E2E2E]">{r.name}</p>
                  <p className="text-sm text-[#9AA7B8]">
                    {r.table} · {r.seats} Personen
                  </p>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full mt-6 py-3.5 rounded-2xl bg-[#A8BCA1] text-white font-medium active:scale-[0.98]"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
