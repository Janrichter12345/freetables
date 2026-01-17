import { Marker, Popup } from "react-leaflet";
import { Link } from "react-router-dom";
import L from "leaflet";

export default function MapMarker({ restaurant }) {
  const markerIcon = L.divIcon({
    className: "",
    html: `
      <div style="
        width: 38px;
        height: 38px;
        background: #A8BCA1;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: 700;
        box-shadow: 0 6px 18px rgba(0,0,0,0.25);
        border: 3px solid white;
      ">
        ${restaurant.availableTables}
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });

  return (
    <Marker
      position={[restaurant.lat, restaurant.lng]}
      icon={markerIcon}
    >
      <Popup closeButton={false}>
        <div className="w-[180px]">
          <h3 className="font-semibold text-[#2E2E2E] text-sm">
            {restaurant.name}
          </h3>

          <p className="text-xs text-[#9AA7B8] mt-1">
            {restaurant.cuisine}
          </p>

          <p className="text-xs mt-1">
            {restaurant.availableTables} Tische verfügbar
          </p>

          <Link
            to={`/restaurant/${restaurant.id}`}
            className="mt-2 inline-block w-full text-center bg-[#A8BCA1] text-white text-xs font-medium py-2 rounded-lg"
          >
            Mehr Infos
          </Link>
        </div>
      </Popup>
    </Marker>
  );
}
