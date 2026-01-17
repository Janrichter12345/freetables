// src/components/checkins/CheckInList.jsx
export default function CheckInList({ checkIns }) {
  const list = Array.isArray(checkIns) ? checkIns : [];
  const count = list.length;

  return (
    <div className="bg-white rounded-2xl border border-[#E7E2D7] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#2E2E2E]">Check-ins</h2>
          <p className="text-sm text-[#9AA7B8]">
            Bestätigte Reservierungen (letzte 24h)
          </p>
        </div>

        <div className="w-10 h-10 rounded-2xl border border-[#E7E2D7] bg-[#F8F7F4] flex items-center justify-center text-[#2E2E2E] font-semibold">
          {count}
        </div>
      </div>

      {count === 0 ? (
        <div className="mt-4 text-sm text-[#9AA7B8]">
          Keine Check-ins in den letzten 24 Stunden.
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {list.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between border border-[#E7E2D7] rounded-2xl p-3 bg-[#F8F7F4]/50"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#2E2E2E] truncate">
                  <span className="font-bold">{c.tableLabel || "Tisch"}</span>
                  {c.guests ? (
                    <span className="text-[#9AA7B8] font-medium"> · {c.guests} Pers.</span>
                  ) : null}
                </div>

                <div className="text-sm text-[#6F7C8C] truncate">
                  {c.name || "—"}
                </div>
              </div>

              <div className="shrink-0 text-sm font-semibold text-[#2E2E2E]">
                {c.time || ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
