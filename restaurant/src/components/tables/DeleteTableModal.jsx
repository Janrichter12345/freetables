export default function DeleteTableModal({ tableName, onConfirm, onClose }) {
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
              Tisch löschen
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
          <p className="text-sm text-[#2E2E2E] mb-6 leading-relaxed">
            Möchten Sie den Tisch{" "}
            <span className="font-semibold">{tableName}</span>{" "}
            wirklich löschen?
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={onClose}
              className="w-full sm:flex-1 py-3.5 rounded-2xl border border-[#E7E2D7] bg-white active:scale-[0.98]"
            >
              Abbrechen
            </button>

            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className="w-full sm:flex-1 py-3.5 rounded-2xl bg-[#2E2E2E] text-white active:scale-[0.98]"
            >
              Löschen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
