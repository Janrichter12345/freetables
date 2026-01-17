import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Search, SlidersHorizontal, X } from "lucide-react";

export default function RestaurantsPage() {
  const navigate = useNavigate();

  const [restaurants, setRestaurants] = useState([]);
  const [search, setSearch] = useState("");

  const [activeCuisines, setActiveCuisines] = useState([]);
  const [activeTags, setActiveTags] = useState([]);
  const [minRating, setMinRating] = useState(0);

  const [filterOpen, setFilterOpen] = useState(false);

  const [ratings, setRatings] = useState({});
  const ratingReqRef = useRef(0);

  const cuisines = ["Pizza", "Burger", "Italienisch", "Asiatisch", "Steak", "Frühstück", "Dessert"];
  const tags = ["Vegan", "Vegetarisch", "Glutenfrei", "Fisch", "Bar"];

  const ratingOptions = [
    { label: "Alle", value: 0 },
    { label: "3.5+", value: 3.5 },
    { label: "4.0+", value: 4.0 },
    { label: "4.5+", value: 4.5 },
  ];

  const TTL_MS = 6 * 60 * 60 * 1000;

  const parseCsvFilters = (csv) =>
    String(csv || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

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

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select(
          `
          id,
          name,
          cuisine,
          address,
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
        const freeTablesCount = (r.tables || []).filter((t) => t.status === "frei").length;
        return { ...r, freeTablesCount };
      });

      setRestaurants(mapped);
    };

    load();
  }, []);

  useEffect(() => {
    if (!restaurants.length) return;

    const myReq = ++ratingReqRef.current;
    let cancelled = false;

    const run = async () => {
      const initial = {};
      for (const r of restaurants) {
        const cached = readRatingCache(r.id);
        initial[r.id] = cached
          ? { status: "ok", rating: cached.rating, total: cached.total }
          : { status: "idle", rating: null, total: null };
      }
      setRatings((prev) => ({ ...prev, ...initial }));

      for (const r of restaurants) {
        if (cancelled || myReq !== ratingReqRef.current) return;

        const cached = readRatingCache(r.id);
        if (cached) continue;

        const name = typeof r.name === "string" ? r.name.trim() : "";
        const address = typeof r.address === "string" ? r.address.trim() : "";

        if (!name && !address) {
          setRatings((prev) => ({
            ...prev,
            [r.id]: { status: "fail", rating: null, total: null },
          }));
          continue;
        }

        setRatings((prev) => ({
          ...prev,
          [r.id]: { ...(prev[r.id] || {}), status: "loading" },
        }));

        try {
          const { data, error } = await supabase.functions.invoke("google-rating", {
            body: { name, address },
          });

          if (cancelled || myReq !== ratingReqRef.current) return;

          if (error || !data?.ok || !data?.found || typeof data.rating !== "number") {
            setRatings((prev) => ({
              ...prev,
              [r.id]: { status: "fail", rating: null, total: null },
            }));
            continue;
          }

          const payload = {
            rating: data.rating,
            total: typeof data.user_ratings_total === "number" ? data.user_ratings_total : null,
            place_id: data.place_id ?? null,
            name: data.name ?? null,
          };

          writeRatingCache(r.id, payload);

          setRatings((prev) => ({
            ...prev,
            [r.id]: { status: "ok", rating: payload.rating, total: payload.total },
          }));
        } catch {
          if (cancelled || myReq !== ratingReqRef.current) return;
          setRatings((prev) => ({
            ...prev,
            [r.id]: { status: "fail", rating: null, total: null },
          }));
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [restaurants]);

  const toggleItem = (value, setList) => {
    setList((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const resetFilters = () => {
    setActiveCuisines([]);
    setActiveTags([]);
    setMinRating(0);
  };

  const selectedChips = useMemo(() => {
    const out = [];
    activeCuisines.forEach((c) => out.push({ type: "cuisine", value: c, label: c }));
    activeTags.forEach((t) => out.push({ type: "tag", value: t, label: t }));
    if (minRating > 0) out.push({ type: "rating", value: minRating, label: `⭐ ${minRating.toFixed(1)}+` });
    return out;
  }, [activeCuisines, activeTags, minRating]);

  const removeChip = (chip) => {
    if (chip.type === "cuisine") setActiveCuisines((p) => p.filter((x) => x !== chip.value));
    if (chip.type === "tag") setActiveTags((p) => p.filter((x) => x !== chip.value));
    if (chip.type === "rating") setMinRating(0);
  };

  const visibleRestaurants = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();

    const filtered = restaurants.filter((r) => {
      const name = String(r?.name || "");
      const address = String(r?.address || "");
      const filters = parseCsvFilters(r?.cuisine);

      const hay = `${name} ${address} ${filters.join(" ")}`.toLowerCase();
      const matchesSearch = q.length === 0 || hay.includes(q);

      const matchesCuisine = activeCuisines.length === 0 || activeCuisines.every((c) => filters.includes(c));
      const matchesTags = activeTags.length === 0 || activeTags.every((t) => filters.includes(t));

      let matchesRating = true;
      if (minRating > 0) {
        const rr = ratings[r.id];
        matchesRating = rr?.status === "ok" && typeof rr.rating === "number" && rr.rating >= minRating;
      }

      return matchesSearch && matchesCuisine && matchesTags && matchesRating;
    });

    filtered.sort((a, b) => (b.freeTablesCount || 0) - (a.freeTablesCount || 0));
    return filtered;
  }, [restaurants, search, activeCuisines, activeTags, minRating, ratings]);

  const Stars = ({ value }) => {
    const v = Math.max(0, Math.min(5, Number(value) || 0));
    const full = Math.floor(v);
    const half = v - full >= 0.5;
    const empty = 5 - full - (half ? 1 : 0);

    return (
      <span className="inline-flex items-center gap-[3px] leading-none">
        {Array.from({ length: full }).map((_, i) => <span key={`f${i}`}>★</span>)}
        {half && <span>☆</span>}
        {Array.from({ length: empty }).map((_, i) => <span key={`e${i}`}>☆</span>)}
      </span>
    );
  };

  const filterCount = selectedChips.length;

  // ✅ Filter offen => kein Scrollen im Hintergrund (und es fühlt sich “fix” an)
  useEffect(() => {
    const prev = document.body.style.overflow;
    if (filterOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [filterOpen]);

  return (
    <div className="min-h-full bg-[#F8F7F4]">
      {/* ✅ Sticky: Suchleiste ganz oben (höher) + Chips */}
      <div className="sticky top-14 z-40 bg-[#F8F7F4]/95 backdrop-blur border-b border-[#E7E2D7]">
        <div className="px-4 pt-2 pb-2">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9AA7B8]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nach Restaurant suchen..."
                className="w-full pl-12 pr-4 py-2.5 rounded-full bg-white border border-[#E7E2D7] shadow-sm outline-none text-sm sm:text-lg"
              />
            </div>

            <button
              type="button"
              onClick={() => setFilterOpen(true)}
              className="relative w-11 h-11 rounded-full bg-white border border-[#E7E2D7] shadow-sm flex items-center justify-center active:scale-[0.98]"
              aria-label="Filter öffnen"
              title="Filter"
            >
              <SlidersHorizontal className="w-5 h-5 text-[#2E2E2E]" />
              {filterCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#6F8F73] text-white text-[11px] leading-[18px] text-center font-semibold">
                  {filterCount}
                </span>
              )}
            </button>
          </div>

          {selectedChips.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              {selectedChips.map((chip) => (
                <button
                  key={`${chip.type}-${chip.value}`}
                  type="button"
                  onClick={() => removeChip(chip)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/80 border border-[#E7E2D7] text-[#2E2E2E] text-xs sm:text-sm font-semibold active:scale-[0.98]"
                  title="Entfernen"
                >
                  {chip.label}
                  <X size={16} className="opacity-60" />
                </button>
              ))}

              <button
                type="button"
                onClick={resetFilters}
                className="px-3 py-2 rounded-full bg-[#F8F7F4] border border-[#E7E2D7] text-[#2E2E2E] text-xs sm:text-sm font-semibold active:scale-[0.98]"
              >
                Alles löschen
              </button>
            </div>
          )}
        </div>
      </div>

      {/* LISTE */}
      <div className="px-4 py-3 pb-24 sm:max-w-4xl sm:mx-auto">
        {visibleRestaurants.map((r) => {
          const gr = ratings[r.id] || { status: "idle", rating: null, total: null };
          const hasFree = (r.freeTablesCount || 0) > 0;

          return (
            <div
              key={r.id}
              onClick={() => navigate(`/restaurant/${r.id}`)}
              className="bg-white rounded-3xl overflow-hidden mb-3 cursor-pointer shadow-sm border border-[#E7E2D7]/50 transition active:scale-[0.99]"
            >
              <div className="p-3 sm:p-5">
                <div className="grid grid-cols-[1fr_auto] gap-x-3 sm:gap-x-4 gap-y-1 items-center">
                  <h2 className="col-span-2 text-[14px] sm:text-2xl font-semibold text-[#2E2E2E] truncate leading-tight">
                    {r.name}
                  </h2>

                  <div className="min-w-0">
                    {gr.status === "loading" ? (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-[#F8F7F4] text-[#7A8696] text-[11px] sm:text-sm whitespace-nowrap">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#6F8F73] animate-pulse" />
                        Google Bewertung lädt…
                      </div>
                    ) : gr.status === "ok" && typeof gr.rating === "number" ? (
                      <div className="inline-flex max-w-full items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-[#F8F7F4] select-none whitespace-nowrap overflow-hidden">
                        <span className="text-[#2E2E2E] font-semibold text-[11px] sm:text-base shrink-0">
                          {gr.rating.toFixed(1)}
                        </span>

                        <span className="text-[#C7A24A] text-[11px] sm:text-base shrink-0">
                          <Stars value={gr.rating} />
                        </span>

                        {typeof gr.total === "number" && (
                          <span className="text-[#9AA7B8] text-[11px] sm:text-sm shrink-0">({gr.total})</span>
                        )}

                        <span className="text-[#9AA7B8] text-[11px] sm:text-sm shrink-0">·</span>

                        <span className="inline-flex items-center gap-2 text-[#9AA7B8] text-[11px] sm:text-sm min-w-0">
                          <span className="w-6 h-6 rounded-full bg-white shadow-sm flex items-center justify-center text-[#2E2E2E] font-semibold shrink-0">
                            G
                          </span>
                          <span className="truncate">Google</span>
                        </span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-[#F8F7F4] text-[#9AA7B8] text-[11px] sm:text-sm whitespace-nowrap">
                        Google Bewertung nicht verfügbar
                      </div>
                    )}
                  </div>

                  <div
                    className={`shrink-0 flex flex-col items-center justify-center rounded-2xl px-2.5 py-2 sm:px-4 sm:py-3 min-w-[68px] sm:min-w-[96px]
                      ${hasFree ? "bg-[#A8BCA1]/20" : "bg-[#E7E2D7]/35"}`}
                  >
                    <span
                      className={`text-[9px] sm:text-xs uppercase tracking-wide font-semibold leading-none ${
                        hasFree ? "text-[#6F8F73]" : "text-[#7A8696]"
                      }`}
                    >
                      {hasFree ? "Jetzt frei" : "Aktuell"}
                    </span>
                    <span className="text-[21px] sm:text-3xl font-bold text-[#2E2E2E] leading-none mt-1">
                      {r.freeTablesCount}
                    </span>
                    <span className="text-[10px] sm:text-sm text-[#2E2E2E] leading-none mt-1">
                      Tische
                    </span>
                  </div>

                  <p className="col-span-1 text-[10.5px] sm:text-base text-[#9AA7B8] leading-snug min-w-0 truncate">
                    📍 {r.address}
                  </p>
                  <div className="col-span-1" />
                </div>
              </div>
            </div>
          );
        })}

        {visibleRestaurants.length === 0 && (
          <div className="bg-white rounded-2xl p-6 text-center text-[#9AA7B8]">
            Keine Restaurants gefunden.
          </div>
        )}
      </div>

      {/* FILTER SHEET */}
      {filterOpen && (
        <div
          className="fixed inset-0 z-[9999] bg-black/40 flex items-end sm:items-center sm:justify-center overscroll-none"
          onClick={() => setFilterOpen(false)}
        >
          <div
            className="w-full sm:max-w-xl bg-white rounded-t-3xl sm:rounded-3xl p-4 sm:p-6 overflow-hidden touch-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-base sm:text-lg font-semibold text-[#2E2E2E]">Filter</div>
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                className="w-10 h-10 rounded-full bg-[#F8F7F4] flex items-center justify-center active:scale-[0.98]"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>

            <div className="mt-4">
              <div className="text-xs uppercase tracking-wide text-[#9AA7B8] font-semibold mb-2">Küche</div>
              <div className="flex flex-wrap gap-2">
                {cuisines.map((c) => {
                  const on = activeCuisines.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleItem(c, setActiveCuisines)}
                      className={`px-4 py-2 rounded-full text-sm font-semibold border transition active:scale-[0.98]
                        ${on ? "bg-[#A8BCA1] text-white border-[#A8BCA1]" : "bg-white text-[#2E2E2E] border-[#E7E2D7]"}`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5">
              <div className="text-xs uppercase tracking-wide text-[#9AA7B8] font-semibold mb-2">Eigenschaften</div>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => {
                  const on = activeTags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleItem(t, setActiveTags)}
                      className={`px-4 py-2 rounded-full text-sm font-semibold border transition active:scale-[0.98]
                        ${on ? "bg-[#A8BCA1] text-white border-[#A8BCA1]" : "bg-white text-[#2E2E2E] border-[#E7E2D7]"}`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5">
              <div className="text-xs uppercase tracking-wide text-[#9AA7B8] font-semibold mb-2">Bewertung</div>
              <div className="flex flex-wrap gap-2">
                {ratingOptions.map((opt) => {
                  const on = minRating === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setMinRating(opt.value)}
                      className={`px-4 py-2 rounded-full text-sm font-semibold border transition active:scale-[0.98]
                        ${on ? "bg-[#6F8F73] text-white border-[#6F8F73]" : "bg-white text-[#2E2E2E] border-[#E7E2D7]"}`}
                    >
                      ⭐ {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={resetFilters}
                className="flex-1 py-3 rounded-2xl bg-[#F8F7F4] border border-[#E7E2D7] text-[#2E2E2E] font-semibold active:scale-[0.98]"
              >
                Zurücksetzen
              </button>
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                className="flex-1 py-3 rounded-2xl bg-[#2E2E2E] text-white font-semibold active:scale-[0.98]"
              >
                Anwenden
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
