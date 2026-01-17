import { MapPin } from "lucide-react";

export default function RestaurantListItem({ restaurant, onClick }) {
  // ✅ NUR freie Tische zählen
  const freeTablesCount = (restaurant.tables || []).filter(
    (t) => t.status === "frei"
  ).length;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-3xl border border-[#E7E2D7]/30 overflow-hidden cursor-pointer transition active:scale-[0.98]"
    >
      {/* Bild */}
      <div className="relative h-40">
        <img
          src={restaurant.image}
          alt={restaurant.name}
          className="w-full h-full object-cover"
        />

        {/* ✅ KORREKTE ANZAHL */}
        <div className="absolute bottom-3 left-3 bg-white px-3 py-1 rounded-full text-sm shadow">
          🟢 {freeTablesCount} frei
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex justify-between items-start mb-1">
          <h3 className="font-semibold text-lg text-[#2E2E2E]">
            {restaurant.name}
          </h3>

          {restaurant.distance && (
            <span className="text-sm text-[#9AA7B8]">
              {restaurant.distance.toFixed(1)} km
            </span>
          )}
        </div>

        <p className="text-sm text-[#9AA7B8] mb-2">
          {restaurant.cuisine}
        </p>

        <div className="flex items-center gap-2 text-sm text-[#9AA7B8]">
          <MapPin className="w-4 h-4" />
          {restaurant.address}
        </div>
      </div>
    </div>
  );
}
