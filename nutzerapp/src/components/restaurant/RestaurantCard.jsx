import { Link } from "react-router-dom";
import { Star, Utensils } from "lucide-react";

export default function RestaurantCard({ restaurant }) {
  return (
    <Link to={`/restaurant/${restaurant.id}`}>
      <div className="bg-white rounded-2xl border border-[#E7E2D7]/40 p-4">
        <div className="flex gap-3">
          <div className="w-12 h-12 bg-[#E7E2D7]/40 rounded-2xl flex items-center justify-center">
            <Utensils className="w-6 h-6 text-[#9AA7B8]" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <h3 className="font-semibold text-[#2E2E2E] truncate">
                {restaurant.name}
              </h3>
              <div className="flex items-center gap-1 ml-2">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <span className="text-sm font-medium text-[#2E2E2E]">
                  {restaurant.rating?.toFixed(1) ?? "4.5"}
                </span>
              </div>
            </div>
            <p className="text-xs text-[#9AA7B8] mt-1">
              {restaurant.cuisine_type} • {restaurant.address}
            </p>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-[#9AA7B8]">
                {restaurant.available_tables}{" "}
                {restaurant.available_tables === 1 ? "Tisch" : "Tische"} verfügbar
              </span>
              <span className="px-3 py-1 bg-[#A8BCA1] text-white text-xs rounded-full">
                Jetzt
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
