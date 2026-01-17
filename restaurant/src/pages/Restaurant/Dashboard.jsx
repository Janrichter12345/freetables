// src/pages/partner/Dashboard.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Layout from "../../components/layout/Layout";
import TableCard from "../../components/tables/TableCard";
import CheckInList from "../../components/checkins/CheckInList";
import AddTableModal from "../../components/tables/AddTableModal";
import TableStatusModal from "../../components/tables/TableStatusModal";
import DeleteTableModal from "../../components/tables/DeleteTableModal";
import { supabase } from "../../lib/supabase";

const LS_REST_ID = "ft_partner_restaurant_id";
const LS_REST_NAME = "ft_partner_restaurant_name";
const EVT_REST_CHANGED = "ft:partner_restaurant_changed";

/* ------------------ Datum ------------------ */
const today = new Date().toLocaleDateString("de-DE", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function cacheRestaurant(rest) {
  try {
    localStorage.setItem(LS_REST_ID, rest?.id || "");
    localStorage.setItem(LS_REST_NAME, rest?.name || "");
    window.dispatchEvent(new Event(EVT_REST_CHANGED));
  } catch {
    // ignore
  }
}

function readCachedRestaurant() {
  try {
    const id = localStorage.getItem(LS_REST_ID) || "";
    const name = localStorage.getItem(LS_REST_NAME) || "";
    return id ? { id, name } : null;
  } catch {
    return null;
  }
}

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();

  const basePath = useMemo(() => {
    return location.pathname.startsWith("/partner") ? "/partner" : "";
  }, [location.pathname]);

  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const [restaurant, setRestaurant] = useState(() => readCachedRestaurant());
  const [tables, setTables] = useState([]);
  const [checkIns, setCheckIns] = useState([]);

  const [activeTable, setActiveTable] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tableToDelete, setTableToDelete] = useState(null);

  // 🔑 interner Namensspeicher (nur UI)
  const nameMapRef = useRef({});

  // Filter
  const [filter, setFilter] = useState("all"); // all | frei | gebucht | besetzt

  // Mobile Swipe
  const scrollerRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // ✅ Session re-hydraten (Refresh-fest)
  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data?.session || null);
      setAuthReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess || null);
      setAuthReady(true);
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // ✅ Restaurant automatisch über restaurants.email = auth.email holen
  useEffect(() => {
    if (!authReady) return;

    if (!session?.user?.email) {
      setRestaurant(null);
      setTables([]);
      setCheckIns([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      const email = String(session.user.email || "").trim();
      if (!email) return;

      const cached = readCachedRestaurant();
      if (cached?.id) {
        setRestaurant((p) => (p?.id ? p : cached));
      }

      if (cached?.id) {
        const { data: restById } = await supabase
          .from("restaurants")
          .select("id,name,email,created_at")
          .eq("id", cached.id)
          .maybeSingle();

        if (cancelled) return;

        if (restById?.id) {
          setRestaurant({ id: restById.id, name: restById.name || "" });
          cacheRestaurant({ id: restById.id, name: restById.name || "" });
          return;
        }
      }

      const { data: restByEmail } = await supabase
        .from("restaurants")
        .select("id,name,email,created_at")
        .ilike("email", email)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (restByEmail?.id) {
        const next = { id: restByEmail.id, name: restByEmail.name || "" };
        setRestaurant(next);
        cacheRestaurant(next);
      } else {
        setRestaurant(null);
        cacheRestaurant(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [authReady, session?.user?.email]);

  const loadTables = async (restaurantId) => {
    if (!restaurantId) return;

    const { data, error } = await supabase
      .from("tables")
      .select("id, seats, status")
      .eq("restaurant_id", restaurantId);

    if (error) {
      console.error(error);
      return;
    }

    const enriched = (data || []).map((t) => ({
      ...t,
      internalName: nameMapRef.current[t.id] ?? null,
    }));

    enriched.sort((a, b) => {
      const nA = a.internalName?.match(/\d+/)?.[0];
      const nB = b.internalName?.match(/\d+/)?.[0];
      if (nA && nB) return Number(nA) - Number(nB);
      if (nA) return -1;
      if (nB) return 1;
      return (a.seats || 0) - (b.seats || 0);
    });

    setTables(enriched);
  };

  const loadCheckIns = async (restaurantId) => {
    if (!restaurantId) return;

    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("reservations")
      .select(
        `
        id,
        created_at,
        eta_minutes,
        arrival_minutes,
        reserved_for,
        customer_name,
        reserver_name,
        seats,
        table:tables ( id, seats )
      `
      )
      .eq("restaurant_id", restaurantId)
      .eq("status", "accepted")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.warn("checkins load error:", error);
      setCheckIns([]);
      return;
    }

    const list = (data || []).map((r) => {
      const createdMs = r?.created_at ? new Date(r.created_at).getTime() : Date.now();
      const mins = Number(r?.arrival_minutes ?? r?.eta_minutes ?? 0);
      const arrivalMs = createdMs + Math.max(0, mins) * 60 * 1000;

      const timeLabel = new Date(arrivalMs).toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const seats = Number(r?.table?.seats ?? r?.seats ?? 0) || 0;
      const name =
        String(r?.reserved_for || r?.customer_name || r?.reserver_name || "").trim() || "—";

      return {
        id: r.id,
        tableLabel: seats ? `Tisch ${seats}` : "Tisch",
        guests: seats || null,
        name,
        time: timeLabel,
      };
    });

    setCheckIns(list);
  };

  useEffect(() => {
    const rid = restaurant?.id;
    if (!rid) return;
    loadTables(rid);
    loadCheckIns(rid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.id]);

  const changeStatus = async (newStatus) => {
    if (!activeTable) return;

    await supabase.from("tables").update({ status: newStatus }).eq("id", activeTable.id);

    setActiveTable(null);
    if (restaurant?.id) {
      loadTables(restaurant.id);
      loadCheckIns(restaurant.id);
    }
  };

  const addTable = async ({ name, seats }) => {
    if (!restaurant?.id) return;

    const { data, error } = await supabase
      .from("tables")
      .insert({
        restaurant_id: restaurant.id,
        seats,
        status: "frei",
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      return;
    }

    nameMapRef.current[data.id] = name || `Tisch ${seats}`;

    setShowAddModal(false);
    loadTables(restaurant.id);
  };

  const confirmDelete = async () => {
    if (!tableToDelete) return;
    await supabase.from("tables").delete().eq("id", tableToDelete.id);
    delete nameMapRef.current[tableToDelete.id];

    setDeleteOpen(false);
    setTableToDelete(null);

    if (restaurant?.id) loadTables(restaurant.id);
  };

  const isOccupied = (s) => s === "besetzt" || s === "reserviert";

  const freeCount = tables.filter((t) => t.status === "frei").length;
  const bookedCount = tables.filter((t) => t.status === "gebucht").length;
  const occupiedCount = tables.filter((t) => isOccupied(t.status)).length;
  const totalCount = tables.length;

  const filteredTables = useMemo(() => {
    if (filter === "all") return tables;
    if (filter === "frei") return tables.filter((t) => t.status === "frei");
    if (filter === "gebucht") return tables.filter((t) => t.status === "gebucht");
    return tables.filter((t) => isOccupied(t.status));
  }, [tables, filter]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const update = () => {
      const kids = Array.from(el.querySelectorAll("[data-table-slide='1']"));
      if (!kids.length) return setActiveIndex(0);

      const center = el.scrollLeft + el.clientWidth / 2;
      let bestIdx = 0;
      let bestDist = Infinity;

      kids.forEach((k, idx) => {
        const kCenter = k.offsetLeft + k.offsetWidth / 2;
        const d = Math.abs(kCenter - center);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = idx;
        }
      });

      setActiveIndex(bestIdx);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [filteredTables.length]);

  const setFilterAndReset = (next) => {
    setFilter(next);
    setActiveIndex(0);
    scrollerRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  };

  const goRestaurantDetails = () => navigate(`${basePath}/restaurant-details`);

  return (
    <Layout>
      <div className="bg-white rounded-2xl border p-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
          <div>
            <h1 className="text-lg font-semibold">Tisch Übersicht</h1>
            <p className="text-sm text-[#9AA7B8]">Verwalten Sie Ihre freien Tische</p>

            {!restaurant?.id && (
              <div className="mt-2 text-sm text-[#9AA7B8]">
                Kein Restaurant gewählt{" "}
                <button
                  type="button"
                  onClick={goRestaurantDetails}
                  className="underline underline-offset-4"
                >
                  (Restaurant Details öffnen)
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            disabled={!restaurant?.id}
            className="bg-[#A8BCA1] text-white px-4 py-2 rounded-xl w-full sm:w-auto active:scale-[0.98] disabled:opacity-50"
            type="button"
          >
            + Tisch hinzufügen
          </button>
        </div>

        <div className="mt-4 bg-[#F8F7F4] px-3 py-2 rounded-xl">
          📅 Heute: {today}
        </div>

        {/* ✅ CLEAN FILTER CHIPS (klein, locker, counts drin) */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilterAndReset("all")}
            label="Alle"
            count={totalCount}
          />
          <FilterChip
            active={filter === "frei"}
            onClick={() => setFilterAndReset("frei")}
            label="Frei"
            count={freeCount}
          />
          <FilterChip
            active={filter === "gebucht"}
            onClick={() => setFilterAndReset("gebucht")}
            label="Gebucht"
            count={bookedCount}
          />
          <FilterChip
            active={filter === "besetzt"}
            onClick={() => setFilterAndReset("besetzt")}
            label="Besetzt"
            count={occupiedCount}
          />
        </div>

        {/* ✅ Mobile: 1 Karte pro Swipe */}
        <div
          ref={scrollerRef}
          className="
            mt-5
            sm:hidden
            flex
            overflow-x-auto
            snap-x snap-mandatory
            px-4
            pb-2
            [scrollbar-width:none] [-ms-overflow-style:none]
            [&::-webkit-scrollbar]:hidden
          "
        >
          {filteredTables.map((table) => (
            <div key={table.id} data-table-slide="1" className="shrink-0 w-full snap-center pr-4">
              <TableCard
                table={{
                  ...table,
                  name: table.internalName || `Tisch ${table.seats}`,
                }}
                onStatusClick={() => setActiveTable(table)}
                onDelete={() => {
                  setTableToDelete(table);
                  setDeleteOpen(true);
                }}
              />
            </div>
          ))}
        </div>

        {/* ✅ Desktop: Grid */}
        <div className="hidden sm:grid mt-5 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredTables.map((table) => (
            <TableCard
              key={table.id}
              table={{
                ...table,
                name: table.internalName || `Tisch ${table.seats}`,
              }}
              onStatusClick={() => setActiveTable(table)}
              onDelete={() => {
                setTableToDelete(table);
                setDeleteOpen(true);
              }}
            />
          ))}
        </div>

        {/* 📱 Dots (nur mobile, dezenter, ohne “Punkte im Filter”) */}
        {filteredTables.length > 1 && (
          <div className="sm:hidden mt-2 flex items-center justify-center gap-2">
            {filteredTables.slice(0, 12).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === activeIndex ? "w-6 bg-[#2E2E2E]" : "w-2 bg-[#E7E2D7]"
                }`}
              />
            ))}
            {filteredTables.length > 12 && <div className="text-xs text-[#9AA7B8] ml-2">…</div>}
          </div>
        )}
      </div>

      <CheckInList checkIns={checkIns} />

      {activeTable && (
        <TableStatusModal
          currentStatus={activeTable.status}
          onSelect={changeStatus}
          onClose={() => setActiveTable(null)}
        />
      )}

      {showAddModal && <AddTableModal onAdd={addTable} onClose={() => setShowAddModal(false)} />}

      {deleteOpen && tableToDelete && (
        <DeleteTableModal
          tableName={tableToDelete.internalName}
          onConfirm={confirmDelete}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </Layout>
  );
}

function FilterChip({ active, onClick, label, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        inline-flex items-center gap-2
        rounded-full border
        px-3 py-1.5
        text-sm font-medium
        transition-colors active:scale-[0.99]
        ${active
          ? "bg-[#2E2E2E] text-white border-[#2E2E2E]"
          : "bg-white text-[#2E2E2E] border-[#E7E2D7] hover:bg-[#F8F7F4]"
        }
      `}
    >
      <span className="leading-none">{label}</span>
      <span
        className={`
          min-w-[24px] text-center
          text-[12px] leading-none
          px-2 py-1 rounded-full
          ${active ? "bg-white/15 text-white" : "bg-[#F8F7F4] text-[#7A8696]"}
        `}
      >
        {count}
      </span>
    </button>
  );
}
