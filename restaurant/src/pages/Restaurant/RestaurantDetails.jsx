import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

const RESTAURANT_ID = "31391688-5672-4801-8691-3e3d15ac3e6a";

// ✅ alle Filter aus der Nutzerapp (Küche + Tags)
const CUISINES = ["Pizza", "Burger", "Italienisch", "Asiatisch", "Steak", "Frühstück", "Dessert"];
const TAGS = ["Vegan", "Vegetarisch", "Glutenfrei", "Fisch", "Bar"];

const AUTOCOMPLETE_LIMIT = 3;

function buildCompactAddress(item) {
  const a = item?.address || {};
  const road = a.road || a.pedestrian || a.footway || a.cycleway || "";
  const house = a.house_number || "";
  const postcode = a.postcode || "";
  const city = a.city || a.town || a.village || a.hamlet || "";
  const part1 = [road, house].filter(Boolean).join(" ").trim();
  const part2 = [postcode, city].filter(Boolean).join(" ").trim();
  const out = [part1, part2].filter(Boolean).join(", ").trim();
  return out || String(item?.display_name || "").split(",").slice(0, 2).join(", ").trim();
}

async function nominatimSearch(q) {
  const query = String(q || "").trim();
  if (!query) return [];

  const withAustria =
    /österreich|austria|\bat\b/i.test(query) ? query : `${query}, Österreich`;

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=${AUTOCOMPLETE_LIMIT}&countrycodes=at&q=${encodeURIComponent(
    withAustria
  )}`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "de",
      "User-Agent": "FreeTables/1.0",
    },
  });
  if (!res.ok) return [];

  const json = await res.json();
  const arr = Array.isArray(json) ? json : [];

  if (arr.length === 0) {
    const tokens = query
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (tokens.length >= 2) {
      const alt = `${tokens.sort((a, b) => a.localeCompare(b)).join(" ")}, Österreich`;
      const url2 = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=${AUTOCOMPLETE_LIMIT}&countrycodes=at&q=${encodeURIComponent(
        alt
      )}`;
      const res2 = await fetch(url2, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "de",
          "User-Agent": "FreeTables/1.0",
        },
      });
      if (!res2.ok) return [];
      const json2 = await res2.json();
      const arr2 = Array.isArray(json2) ? json2 : [];
      return arr2.map((it) => ({
        label: buildCompactAddress(it),
        lat: Number(it.lat),
        lng: Number(it.lon),
      }));
    }
  }

  return arr.map((it) => ({
    label: buildCompactAddress(it),
    lat: Number(it.lat),
    lng: Number(it.lon),
  }));
}

export default function RestaurantDetails() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [uploading, setUploading] = useState(false);
  const [images, setImages] = useState([]); // {id, url, path, sort}

  // ✅ Speisekarte (PDF) — genau 1 Datei pro Restaurant
  const [menuUploading, setMenuUploading] = useState(false);
  const [menuPdf, setMenuPdf] = useState({ url: "", path: "" });

  // ✅ wir speichern Filter als CSV in restaurants.cuisine
  const [selectedFilters, setSelectedFilters] = useState([]);

  const [form, setForm] = useState({
    name: "",
    cuisine: "",
    description: "",
    address: "",
    phone: "",
    website: "",
  });

  // ✅ Adresse Autocomplete (nur intern, Label ist clean)
  const [addrOpen, setAddrOpen] = useState(false);
  const [addrLoading, setAddrLoading] = useState(false);
  const [addrItems, setAddrItems] = useState([]);
  const [addrPick, setAddrPick] = useState(null); // {label, lat, lng}
  const addrBoxRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");

      const { data, error } = await supabase
        .from("restaurants")
        .select("name,cuisine,description,address,phone,website,image,menu_pdf_url,menu_pdf_path,lat,lng")
        .eq("id", RESTAURANT_ID)
        .single();

      if (error) {
        console.error(error);
        setMsg("Fehler beim Laden.");
        setLoading(false);
        return;
      }

      const cuisineStr = data?.cuisine || "";
      const parsed = cuisineStr
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      setSelectedFilters(parsed);

      const addr = data?.address || "";

      setForm({
        name: data?.name || "",
        cuisine: cuisineStr,
        description: data?.description || "",
        address: addr,
        phone: data?.phone || "",
        website: data?.website || "",
      });

      if (Number.isFinite(Number(data?.lat)) && Number.isFinite(Number(data?.lng)) && addr) {
        setAddrPick({ label: addr, lat: Number(data.lat), lng: Number(data.lng) });
      } else {
        setAddrPick(null);
      }

      setMenuPdf({
        url: data?.menu_pdf_url || "",
        path: data?.menu_pdf_path || "",
      });

      const { data: imgs, error: imgErr } = await supabase
        .from("restaurant_images")
        .select("id,url,path,sort,created_at")
        .eq("restaurant_id", RESTAURANT_ID)
        .order("sort", { ascending: true })
        .order("created_at", { ascending: true });

      if (imgErr) console.warn(imgErr);
      setImages((imgs || []).slice(0, 10));

      setLoading(false);
    };

    load();
  }, []);

  const onChange = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  const toggleFilter = (value) => {
    setSelectedFilters((prev) => {
      const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      const csv = next.join(",");
      setForm((p) => ({ ...p, cuisine: csv }));
      return next;
    });
  };

  useEffect(() => {
    let active = true;
    const q = String(form.address || "").trim();

    if (!addrOpen || q.length < 3) {
      setAddrItems([]);
      setAddrLoading(false);
      return;
    }

    setAddrLoading(true);

    const t = setTimeout(async () => {
      const items = await nominatimSearch(q);
      if (!active) return;
      setAddrItems(items.slice(0, AUTOCOMPLETE_LIMIT));
      setAddrLoading(false);
    }, 250);

    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [form.address, addrOpen]);

  useEffect(() => {
    const onDown = (e) => {
      const el = addrBoxRef.current;
      if (!el) return;
      if (!el.contains(e.target)) setAddrOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const onSave = async () => {
    setSaving(true);
    setMsg("");

    try {
      const address = String(form.address || "").trim();
      if (!address) {
        setMsg("❌ Bitte Adresse eingeben.");
        setSaving(false);
        return;
      }

      let lat = null;
      let lng = null;

      if (
        addrPick?.label &&
        addrPick.label === address &&
        Number.isFinite(addrPick.lat) &&
        Number.isFinite(addrPick.lng)
      ) {
        lat = addrPick.lat;
        lng = addrPick.lng;
      } else {
        const items = await nominatimSearch(address);
        const best = items?.[0] || null;

        if (!(Number.isFinite(best?.lat) && Number.isFinite(best?.lng))) {
          setMsg("❌ Adresse konnte nicht automatisch erkannt werden. Bitte Vorschlag auswählen.");
          setSaving(false);
          return;
        }

        lat = best.lat;
        lng = best.lng;
        setAddrPick({ label: address, lat, lng });
      }

      const { error } = await supabase
        .from("restaurants")
        .update({
          name: form.name,
          cuisine: form.cuisine,
          description: form.description,
          address,
          phone: form.phone,
          website: form.website,
          lat,
          lng,
        })
        .eq("id", RESTAURANT_ID);

      if (error) throw error;

      setMsg("✅ Gespeichert – Nutzerapp kann danach filtern.");
    } catch (err) {
      console.error(err);
      setMsg("❌ Speichern fehlgeschlagen.");
    }

    setSaving(false);
  };

  const uploadMenuPdf = async (file) => {
    if (!file) return;
    setMsg("");

    const isPdf =
      file.type === "application/pdf" || String(file.name || "").toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      setMsg("❌ Bitte eine PDF-Datei auswählen.");
      return;
    }

    const MAX = 15 * 1024 * 1024;
    if (file.size > MAX) {
      setMsg("❌ PDF ist zu groß (max. 15MB).");
      return;
    }

    setMenuUploading(true);

    try {
      const path = `${RESTAURANT_ID}/menu.pdf`;

      await supabase.storage.from("restaurant-menus").remove([path]).then(() => {});

      const { error: upErr } = await supabase.storage
        .from("restaurant-menus")
        .upload(path, file, { upsert: false, contentType: "application/pdf" });

      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("restaurant-menus").getPublicUrl(path);
      const url = pub?.publicUrl;

      if (!url) throw new Error("Public URL konnte nicht erzeugt werden.");

      const { error: dbErr } = await supabase
        .from("restaurants")
        .update({ menu_pdf_url: url, menu_pdf_path: path })
        .eq("id", RESTAURANT_ID);

      if (dbErr) throw dbErr;

      setMenuPdf({ url, path });
      setMsg("✅ Speisekarte (PDF) hochgeladen.");
    } catch (e) {
      console.error(e);
      setMsg("❌ PDF Upload fehlgeschlagen (Bucket/Policy prüfen).");
    } finally {
      setMenuUploading(false);
    }
  };

  const deleteMenuPdf = async () => {
    setMsg("");
    setMenuUploading(true);

    try {
      const path = `${RESTAURANT_ID}/menu.pdf`;

      await supabase.storage.from("restaurant-menus").remove([path]).then(() => {});

      const { error } = await supabase
        .from("restaurants")
        .update({ menu_pdf_url: null, menu_pdf_path: null })
        .eq("id", RESTAURANT_ID);

      if (error) throw error;

      setMenuPdf({ url: "", path: "" });
      setMsg("✅ Speisekarte gelöscht.");
    } catch (e) {
      console.error(e);
      setMsg("❌ Löschen fehlgeschlagen.");
    } finally {
      setMenuUploading(false);
    }
  };

  const canUploadMore = useMemo(() => images.length < 10, [images.length]);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const remaining = Math.max(0, 10 - images.length);
    const toUpload = files.slice(0, remaining);

    if (toUpload.length === 0) {
      setMsg("Maximal 10 Bilder erlaubt.");
      return;
    }

    setUploading(true);
    setMsg("");

    try {
      for (const file of toUpload) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${RESTAURANT_ID}/${Date.now()}_${safeName}`;

        const { error: upErr } = await supabase.storage
          .from("restaurant-images")
          .upload(path, file, { upsert: false, contentType: file.type });

        if (upErr) throw upErr;

        const { data: pub } = supabase.storage.from("restaurant-images").getPublicUrl(path);
        const url = pub?.publicUrl;

        const { data: row, error: insErr } = await supabase
          .from("restaurant_images")
          .insert({ restaurant_id: RESTAURANT_ID, path, url, sort: 0 })
          .select("id,url,path,sort,created_at")
          .single();

        if (insErr) throw insErr;

        setImages((prev) => [...prev, row].slice(0, 10));

        await supabase
          .from("restaurants")
          .update({ image: url })
          .eq("id", RESTAURANT_ID)
          .is("image", null)
          .then(() => {});
      }

      setMsg("✅ Bilder hochgeladen.");
    } catch (e) {
      console.error(e);
      setMsg("❌ Upload fehlgeschlagen (Bucket/Policy prüfen).");
    } finally {
      setUploading(false);
    }
  };

  const deleteImage = async (img) => {
    if (!img?.id) return;
    setMsg("");

    try {
      if (img.path) {
        const { error: rmErr } = await supabase.storage.from("restaurant-images").remove([img.path]);
        if (rmErr) console.warn(rmErr);
      }

      const { error } = await supabase.from("restaurant_images").delete().eq("id", img.id);
      if (error) throw error;

      setImages((prev) => prev.filter((x) => x.id !== img.id));
      setMsg("✅ Bild gelöscht.");
    } catch (e) {
      console.error(e);
      setMsg("❌ Löschen fehlgeschlagen.");
    }
  };

  const goBack = () => {
    try {
      if (window.history.length > 1) navigate(-1);
      else navigate("/dashboard");
    } catch {
      navigate("/dashboard");
    }
  };

  if (loading) return <div className="p-6 text-sm text-[#7A8696]">Lade…</div>;

  return (
    <div className="bg-[#F8F7F4] min-h-screen p-3 sm:p-4">
      <div className="max-w-2xl mx-auto bg-white rounded-3xl p-4 sm:p-6 border border-[#E7E2D7]">
        {/* Top bar: back button dezent */}
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-full border border-[#E7E2D7] bg-white text-[#2E2E2E] font-semibold text-sm hover:bg-[#F8F7F4] active:scale-[0.98]"
          >
            ← <span className="hidden sm:inline">Zurück</span>
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-semibold text-[#2E2E2E] leading-tight">
              Restaurant Details
            </h1>
            <p className="text-sm text-[#9AA7B8] mt-1">
              Diese Infos sieht später die Nutzer-App.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          <Field label="Name">
            <input
              value={form.name}
              onChange={onChange("name")}
              className="w-full bg-[#F8F7F4] rounded-2xl px-4 py-3 outline-none text-base"
            />
          </Field>

          <Field label="Küche & Eigenschaften (mehrere auswählbar)">
            <div className="text-xs text-[#9AA7B8] mb-2 leading-relaxed">
              Ausgewählt: {selectedFilters.length ? selectedFilters.join(", ") : "—"}
            </div>

            <div className="flex gap-2 flex-wrap">
              {CUISINES.map((c) => {
                const active = selectedFilters.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleFilter(c)}
                    className={`px-3 sm:px-4 py-2 rounded-full text-sm transition active:scale-[0.98]
                      ${active ? "bg-[#6F8F73] text-white" : "bg-[#E7E2D7] text-[#2E2E2E]"}`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex gap-2 flex-wrap">
              {TAGS.map((t) => {
                const active = selectedFilters.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleFilter(t)}
                    className={`px-3 sm:px-4 py-2 rounded-full text-sm transition active:scale-[0.98]
                      ${active ? "bg-[#A8BCA1] text-white" : "bg-[#E7E2D7] text-[#2E2E2E]"}`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Beschreibung">
            <textarea
              value={form.description}
              onChange={onChange("description")}
              className="w-full bg-[#F8F7F4] rounded-2xl px-4 py-3 outline-none min-h-[120px] resize-none text-base"
            />
          </Field>

          <Field label="Adresse">
            <div ref={addrBoxRef} className="relative">
              <input
                value={form.address}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((p) => ({ ...p, address: v }));
                  setAddrPick(null);
                }}
                onFocus={() => setAddrOpen(true)}
                placeholder="z.B. Kellergasse 13, 3130 Herzogenburg"
                className="w-full bg-[#F8F7F4] rounded-2xl px-4 py-3 outline-none text-base"
              />

              {(addrOpen && (addrLoading || addrItems.length > 0)) && (
                <div className="absolute z-30 left-0 right-0 mt-2 bg-white border border-[#E7E2D7] rounded-2xl shadow-sm overflow-hidden">
                  <div className="max-h-44 overflow-auto">
                    {addrLoading && (
                      <div className="px-4 py-3 text-sm text-[#9AA7B8]">Suche…</div>
                    )}

                    {!addrLoading &&
                      addrItems.map((it, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setForm((p) => ({ ...p, address: it.label }));
                            setAddrPick({ lat: it.lat, lng: it.lng, label: it.label });
                            setAddrOpen(false);
                          }}
                          className="w-full text-left px-4 py-3 text-sm hover:bg-[#F8F7F4] text-[#2E2E2E]"
                        >
                          {it.label}
                        </button>
                      ))}

                    {!addrLoading && addrItems.length === 0 && (
                      <div className="px-4 py-3 text-sm text-[#9AA7B8]">Keine Treffer.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Telefon">
              <input
                value={form.phone}
                onChange={onChange("phone")}
                className="w-full bg-[#F8F7F4] rounded-2xl px-4 py-3 outline-none text-base"
                placeholder="+43 …"
              />
            </Field>
            <Field label="Webseite">
              <input
                value={form.website}
                onChange={onChange("website")}
                className="w-full bg-[#F8F7F4] rounded-2xl px-4 py-3 outline-none text-base"
                placeholder="https://…"
              />
            </Field>
          </div>

          <Field label="Speisekarte (PDF) – nur 1 Datei">
            <div className="grid gap-3 sm:flex sm:items-center sm:gap-3 sm:flex-wrap">
              <label
                className={`inline-flex items-center justify-center w-full sm:w-auto px-4 py-3 rounded-2xl font-semibold cursor-pointer
                  ${menuUploading ? "bg-[#E7E2D7] text-[#9AA7B8]" : "bg-[#A8BCA1]/25 text-[#6F8F73]"}`}
              >
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  disabled={menuUploading}
                  onChange={(e) => uploadMenuPdf(e.target.files?.[0])}
                />
                {menuUploading ? "Lädt hoch…" : menuPdf.url ? "PDF ersetzen" : "PDF hochladen"}
              </label>

              {menuPdf.url ? (
                <>
                  <a
                    href={menuPdf.url}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full sm:w-auto px-4 py-3 rounded-2xl bg-[#F8F7F4] text-[#2E2E2E] font-semibold border border-[#E7E2D7] transition active:scale-[0.98] text-center"
                  >
                    PDF öffnen
                  </a>

                  <button
                    type="button"
                    onClick={deleteMenuPdf}
                    disabled={menuUploading}
                    className="w-full sm:w-auto px-4 py-3 rounded-2xl bg-white text-[#2E2E2E] font-semibold border border-[#E7E2D7] transition active:scale-[0.98] disabled:opacity-60"
                  >
                    PDF löschen
                  </button>
                </>
              ) : (
                <span className="text-sm text-[#9AA7B8]">Noch keine Speisekarte hinterlegt.</span>
              )}
            </div>

            <div className="text-xs text-[#9AA7B8] mt-2 leading-relaxed">
              Max. 15MB. (Später zeigt die Nutzerapp das PDF im Modal – niemand verlässt deine Seite.)
            </div>
          </Field>

          <Field label={`Bilder (max. 10) – aktuell: ${images.length}/10`}>
            <div className="grid gap-2 sm:flex sm:items-center sm:gap-3">
              <label
                className={`inline-flex items-center justify-center w-full sm:w-auto px-4 py-3 rounded-2xl font-semibold cursor-pointer
                  ${canUploadMore ? "bg-[#A8BCA1]/25 text-[#6F8F73]" : "bg-[#E7E2D7] text-[#9AA7B8] cursor-not-allowed"}`}
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={!canUploadMore || uploading}
                  onChange={(e) => uploadFiles(e.target.files)}
                />
                {uploading ? "Lädt hoch…" : "Bilder hochladen"}
              </label>

              <span className="text-sm text-[#9AA7B8]">(Klick → mehrere auswählen)</span>
            </div>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {images.map((img) => (
                <div
                  key={img.id}
                  className="relative rounded-2xl overflow-hidden bg-[#F8F7F4] border border-[#E7E2D7]"
                >
                  <img src={img.url} alt="Restaurant" className="w-full h-28 object-cover" />
                  <button
                    type="button"
                    onClick={() => deleteImage(img)}
                    className="absolute top-2 right-2 bg-white/90 hover:bg-white text-[#2E2E2E] text-xs px-2 py-1 rounded-full active:scale-[0.98]"
                  >
                    Löschen
                  </button>
                </div>
              ))}
              {images.length === 0 && (
                <div className="text-sm text-[#9AA7B8] col-span-2 sm:col-span-3">
                  Noch keine Bilder hochgeladen.
                </div>
              )}
            </div>
          </Field>
        </div>

        {msg && <div className="mt-4 text-sm text-[#6F8F73]">{msg}</div>}

        <button
          onClick={onSave}
          disabled={saving}
          className="mt-6 w-full bg-[#6F8F73] hover:bg-[#5f7f66] disabled:opacity-60 text-white py-3.5 rounded-2xl font-semibold transition active:scale-[0.98]"
        >
          {saving ? "Speichert…" : "Speichern"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-sm font-semibold text-[#2E2E2E] mb-2">{label}</div>
      {children}
    </div>
  );
}
