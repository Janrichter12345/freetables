import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Navigation } from "lucide-react";

/* ================= White-Map Fix (Route/Tab Wechsel) ================= */
function InvalidateSizeFix() {
  const map = useMap();
  useEffect(() => {
    map.whenReady(() => {
      try {
        map.invalidateSize();
        setTimeout(() => map.invalidateSize(), 120);
        setTimeout(() => map.invalidateSize(), 350);
      } catch {}
    });
  }, [map]);
  return null;
}

/* ================= Center NUR 1x beim Einstieg + manuell per Button ================= */
function GpsCenterOnce({ userLocation, manualNonce, radiusMeters = 200 }) {
  const map = useMap();
  const didInitialRef = useRef(false);
  const lastManualRef = useRef(manualNonce);

  const fitToUser = useCallback(() => {
    if (!Array.isArray(userLocation) || userLocation.length !== 2) return;
    const lat = Number(userLocation[0]);
    const lng = Number(userLocation[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    try {
      // 200m Umkreis -> gleiches "Abstand Gefühl" auf Handy & PC
      const bounds = L.circle([lat, lng], { radius: radiusMeters }).getBounds();
      map.fitBounds(bounds, {
        padding: [24, 24],
        animate: true,
        maxZoom: 19,
      });
    } catch {
      try {
        map.setView([lat, lng], 16, { animate: true });
      } catch {}
    }

    // nochmal invalidate (hilft gegen weiß nach Route/Tab)
    try {
      setTimeout(() => map.invalidateSize(), 60);
    } catch {}
  }, [map, userLocation, radiusMeters]);

  // 1) NUR EINMAL beim ersten GPS
  useEffect(() => {
    if (didInitialRef.current) return;
    if (!userLocation) return;
    didInitialRef.current = true;
    fitToUser();
  }, [userLocation, fitToUser]);

  // 2) NUR bei Button-Klick
  useEffect(() => {
    if (!userLocation) return;
    if (manualNonce === lastManualRef.current) return;
    lastManualRef.current = manualNonce;
    fitToUser();
  }, [manualNonce, userLocation, fitToUser]);

  return null;
}

/* ================= Zoom Tracker (für Skalierung) ================= */
function ZoomTracker({ onZoom }) {
  const map = useMap();

  useEffect(() => {
    const push = () => onZoom(map.getZoom());
    push();
    map.on("zoomend", push);
    return () => map.off("zoomend", push);
  }, [map, onZoom]);

  return null;
}

export default function MapPage() {
  const navigate = useNavigate();

  const [userLocation, setUserLocation] = useState(null);
  const [mapCenter, setMapCenter] = useState([48.2816, 15.6946]);
  const [restaurants, setRestaurants] = useState([]);

  // ✅ GPS Banner Status
  const [geoStatus, setGeoStatus] = useState("idle"); // idle | locating | ok | denied | unavailable | timeout

  // ✅ nur für Button-Recentern
  const [manualNonce, setManualNonce] = useState(0);

  // ✅ Zoom-State (für Punkt/Marker Größen)
  const [zoom, setZoom] = useState(15);
  const onZoom = useCallback((z) => setZoom(z), []);

  // ✅ Google Ratings pro Restaurant
  const [ratings, setRatings] = useState({}); // { [id]: { status, rating, total } }
  const ratingReqRef = useRef(0);

  const TTL_MS = 6 * 60 * 60 * 1000;

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  const parseCoord = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const isValidCoord = (lat, lng) => {
    if (lat == null || lng == null) return false;
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  };

  const geocodeAddress = async (address) => {
    if (!address) return null;
    const q = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`;

    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Language": "de" },
    });
    if (!res.ok) return null;

    const json = await res.json();
    const item = Array.isArray(json) ? json[0] : null;
    const lat = item ? Number(item.lat) : null;
    const lng = item ? Number(item.lon) : null;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  };

  const readRatingCache = (restaurantId) => {
    try {
      const raw = localStorage.getItem(`ft_google_rating_${restaurantId}`);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj?.ts) return null;
      if (Date.now() - obj.ts > TTL_MS) return null;
      if (typeof obj.rating !== "number") return null;
      return {
        rating: obj.rating ?? null,
        total: typeof obj.total === "number" ? obj.total : null,
      };
    } catch {
      return null;
    }
  };

  const writeRatingCache = (restaurantId, payload) => {
    try {
      localStorage.setItem(
        `ft_google_rating_${restaurantId}`,
        JSON.stringify({
          ts: Date.now(),
          rating: payload.rating,
          total: payload.total,
          place_id: payload.place_id ?? null,
          name: payload.name ?? null,
        })
      );
    } catch {}
  };

  /* ================= Standort ================= */
  const locateUser = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      return;
    }

    setGeoStatus("locating");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = [pos.coords.latitude, pos.coords.longitude];
        setUserLocation(c);
        setMapCenter(c); // initialer Center (MapContainer)
        setGeoStatus("ok");
      },
      (err) => {
        if (err?.code === 1) setGeoStatus("denied");
        else if (err?.code === 2) setGeoStatus("unavailable");
        else if (err?.code === 3) setGeoStatus("timeout");
        else setGeoStatus("unavailable");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }, []);

  useEffect(() => {
    locateUser();
  }, [locateUser]);

  /* ================= Restaurants aus Supabase ================= */
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select(
          `
          id,
          name,
          address,
          lat,
          lng,
          tables (
            id,
            status
          )
        `
        );

      if (error) {
        console.error(error);
        return;
      }

      const mapped = (data || []).map((r) => {
        const freeTables = (r.tables || []).filter((t) => t.status === "frei");
        const lat = parseCoord(r.lat);
        const lng = parseCoord(r.lng);

        return {
          ...r,
          lat,
          lng,
          coordsOk: isValidCoord(lat, lng),
          freeTablesCount: freeTables.length,
        };
      });

      if (!cancelled) setRestaurants(mapped);

      // ✅ Auto-Geocode für Restaurants ohne coords
      for (const r of mapped) {
        if (cancelled) return;
        if (r.coordsOk) continue;
        if (!r.address) continue;

        const cacheKey = `ft_geo_${r.id}`;

        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            const obj = JSON.parse(cached);
            if (obj?.lat && obj?.lng && isValidCoord(obj.lat, obj.lng)) {
              if (!cancelled) {
                setRestaurants((prev) =>
                  prev.map((x) =>
                    x.id === r.id ? { ...x, lat: obj.lat, lng: obj.lng, coordsOk: true } : x
                  )
                );
              }
              continue;
            }
          }
        } catch {}

        const coords = await geocodeAddress(r.address);
        if (!coords) continue;

        try {
          localStorage.setItem(cacheKey, JSON.stringify(coords));
        } catch {}

        if (!cancelled) {
          setRestaurants((prev) =>
            prev.map((x) =>
              x.id === r.id ? { ...x, lat: coords.lat, lng: coords.lng, coordsOk: true } : x
            )
          );
        }

        supabase
          .from("restaurants")
          .update({ lat: coords.lat, lng: coords.lng })
          .eq("id", r.id)
          .then(({ error }) => {
            if (error) console.warn("Supabase lat/lng update blocked:", error);
          });
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ================= Ratings holen (Edge Function) ================= */
  const markerRestaurants = useMemo(() => {
    return restaurants.filter((r) => r.freeTablesCount > 0).filter((r) => r.coordsOk);
  }, [restaurants]);

  useEffect(() => {
    if (!markerRestaurants.length) return;

    const myReq = ++ratingReqRef.current;
    let cancelled = false;

    const run = async () => {
      const initial = {};
      for (const r of markerRestaurants) {
        const cached = readRatingCache(r.id);
        initial[r.id] = cached
          ? { status: "ok", rating: cached.rating, total: cached.total }
          : { status: "idle", rating: null, total: null };
      }
      if (!cancelled) setRatings((p) => ({ ...p, ...initial }));

      for (const r of markerRestaurants) {
        if (cancelled || myReq !== ratingReqRef.current) return;

        const cached = readRatingCache(r.id);
        if (cached) continue;

        const name = typeof r.name === "string" ? r.name.trim() : "";
        const address = typeof r.address === "string" ? r.address.trim() : "";

        if (!name && !address) {
          setRatings((p) => ({ ...p, [r.id]: { status: "fail", rating: null, total: null } }));
          continue;
        }

        setRatings((p) => ({ ...p, [r.id]: { ...(p[r.id] || {}), status: "loading" } }));

        try {
          const { data, error } = await supabase.functions.invoke("google-rating", {
            body: { name, address },
          });

          if (cancelled || myReq !== ratingReqRef.current) return;

          if (error || !data?.ok || !data?.found || typeof data.rating !== "number") {
            setRatings((p) => ({ ...p, [r.id]: { status: "fail", rating: null, total: null } }));
            continue;
          }

          const payload = {
            rating: data.rating,
            total: typeof data.user_ratings_total === "number" ? data.user_ratings_total : null,
            place_id: data.place_id ?? null,
            name: data.name ?? null,
          };

          writeRatingCache(r.id, payload);

          setRatings((p) => ({
            ...p,
            [r.id]: { status: "ok", rating: payload.rating, total: payload.total },
          }));
        } catch {
          if (cancelled || myReq !== ratingReqRef.current) return;
          setRatings((p) => ({ ...p, [r.id]: { status: "fail", rating: null, total: null } }));
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [markerRestaurants]);

  /* ================= Skalierung ================= */
  const userSizes = useMemo(() => {
    const z = Number(zoom) || 15;
    const dot = clamp(5 + (z - 12) * 0.7, 6, 10);
    const halo = clamp(14 + (z - 12) * 2.8, 18, 36);
    return { dot, halo };
  }, [zoom]);

  const markerIcon = (count) => {
    const z = Number(zoom) || 15;

    const size = clamp(22 + (z - 12) * 2.0, 24, 34);
    const border = clamp(2 + (z - 12) * 0.2, 2, 3);
    const font = clamp(Math.round(size * 0.42), 11, 15);

    return L.divIcon({
      className: "",
      html: `
        <div style="
          width:${size}px;
          height:${size}px;
          border-radius:999px;
          background:#ffffff;
          border:${border}px solid #6F8F73;
          box-shadow:0 4px 12px rgba(0,0,0,0.18);
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight:800;
          font-size:${font}px;
          color:#2E2E2E;
        ">
          ${count}
        </div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -Math.round(size * 0.45)],
    });
  };

  const Stars = ({ value }) => {
    const v = Math.max(0, Math.min(5, Number(value) || 0));
    const full = Math.floor(v);
    const half = v - full >= 0.5;
    const empty = 5 - full - (half ? 1 : 0);

    return (
      <span className="inline-flex items-center gap-[3px] leading-none text-[#C7A24A]">
        {Array.from({ length: full }).map((_, i) => (
          <span key={`f${i}`}>★</span>
        ))}
        {half && <span>☆</span>}
        {Array.from({ length: empty }).map((_, i) => (
          <span key={`e${i}`}>☆</span>
        ))}
      </span>
    );
  };

  const bannerText =
    geoStatus === "locating"
      ? "Standort wird ermittelt…"
      : geoStatus === "denied"
      ? "Standort deaktiviert – bitte GPS/Standortzugriff erlauben."
      : geoStatus === "timeout"
      ? "Standort dauert zu lange – GPS aktivieren und nochmal versuchen."
      : geoStatus === "unavailable"
      ? "Standort nicht verfügbar – GPS aktivieren."
      : null;

  return (
    <div className="relative w-full overflow-hidden h-[calc(100dvh-112px)] z-0 isolate">
      {/* ✅ Attribution komplett weg */}
      <style>{`
        .leaflet-control-attribution { display: none !important; }
        .leaflet-container { z-index: 0 !important; }
      `}</style>

      {/* ✅ Banner */}
      {bannerText && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3">
          <div className="px-4 py-2 rounded-full bg-white/95 border border-[#E7E2D7] shadow-sm text-xs text-[#7A8696] text-center">
            {bannerText}
          </div>
        </div>
      )}

      <MapContainer
        center={mapCenter}
        zoom={15}
        zoomControl={false}
        attributionControl={false}
        className="h-full w-full z-0"
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution=""
        />

        <InvalidateSizeFix />
        <ZoomTracker onZoom={onZoom} />

        {/* ✅ Auto-Center NUR 1x beim Einstieg (GPS) + manuell über Button */}
        <GpsCenterOnce userLocation={userLocation} manualNonce={manualNonce} radiusMeters={200} />

        {/* Eigener Standort */}
        {userLocation && (
          <>
            <CircleMarker
              center={userLocation}
              radius={userSizes.halo}
              pathOptions={{
                color: "#A8BCA1",
                weight: 1,
                fillColor: "#A8BCA1",
                fillOpacity: 0.18,
              }}
            />
            <CircleMarker
              center={userLocation}
              radius={userSizes.dot}
              pathOptions={{
                color: "white",
                weight: 3,
                fillColor: "#A8BCA1",
                fillOpacity: 1,
              }}
            />
          </>
        )}

        {/* Restaurants */}
        {markerRestaurants.map((r) => {
          const gr = ratings[r.id] || { status: "idle", rating: null, total: null };

          return (
            <Marker key={r.id} position={[r.lat, r.lng]} icon={markerIcon(r.freeTablesCount)}>
              <Popup>
                <div className="min-w-[220px]">
                  <div className="font-semibold text-[#2E2E2E]">{r.name}</div>

                  <div className="mt-2">
                    {gr.status === "loading" ? (
                      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F8F7F4] text-[#7A8696] text-sm">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#6F8F73] animate-pulse" />
                        Google Bewertung lädt…
                      </div>
                    ) : gr.status === "ok" && typeof gr.rating === "number" ? (
                      <div className="inline-flex items-center gap-3 px-3 py-2 rounded-xl bg-[#F8F7F4] select-none">
                        <span className="text-[#2E2E2E] font-semibold text-sm">
                          {gr.rating.toFixed(1)}
                        </span>
                        <Stars value={gr.rating} />
                        {typeof gr.total === "number" && (
                          <span className="text-[#9AA7B8] text-sm">({gr.total})</span>
                        )}
                        <span className="text-[#9AA7B8] text-sm">·</span>
                        <span className="inline-flex items-center gap-2 text-[#9AA7B8] text-sm">
                          <span className="w-6 h-6 rounded-full bg-white shadow-sm flex items-center justify-center text-[#2E2E2E] font-semibold">
                            G
                          </span>
                          Google
                        </span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F8F7F4] text-[#9AA7B8] text-sm">
                        Google Bewertung nicht verfügbar
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => navigate(`/restaurant/${r.id}`)}
                    className="mt-3 w-full bg-[#6F8F73] hover:bg-[#5f7f66] text-white py-2 rounded-xl text-sm"
                  >
                    Weiter Infos
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* ✅ Location Button */}
      <button
        type="button"
        onClick={() => {
          locateUser();
          setManualNonce((x) => x + 1); // ✅ nur dann wieder zentrieren
        }}
        className="absolute right-4 w-14 h-14 bg-white rounded-full shadow-lg border border-[#E7E2D7]
                   flex items-center justify-center z-20 transition active:scale-[0.98]"
        style={{ bottom: "12px" }}
        title="Zu meinem Standort"
      >
        <Navigation className="w-6 h-6 text-[#6F8F73]" />
      </button>
    </div>
  );
}
