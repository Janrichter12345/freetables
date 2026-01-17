export default function TableCard({ table, onStatusClick, onDelete }) {
  const statusColors = {
    frei: "bg-[#A8BCA1] text-white",
    gebucht: "bg-[#9AA7B8] text-white",
    besetzt: "bg-[#2E2E2E] text-white",
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E7E2D7] p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-[#2E2E2E] truncate">
            {table.name}
          </div>
          <div className="text-xs text-[#9AA7B8] mt-1">
            Kapazität
          </div>
        </div>

        <span
          className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${statusColors[table.status]}`}
        >
          {table.status}
        </span>
      </div>

      {/* Seats */}
      <div className="flex items-end justify-between">
        <div className="text-lg font-semibold text-[#2E2E2E]">
          {table.seats} Personen
        </div>

        <button
          onClick={() => onDelete(table.id)}
          className="w-10 h-10 border border-[#E7E2D7] rounded-2xl flex items-center justify-center text-[#9AA7B8] active:scale-[0.98]"
          aria-label="Tisch löschen"
        >
          🗑
        </button>
      </div>

      {/* Action */}
      <button
        onClick={() => onStatusClick(table)}
        className="w-full bg-[#2E2E2E] text-white text-sm py-2.5 rounded-2xl active:scale-[0.98]"
      >
        Status ändern
      </button>
    </div>
  );
}
