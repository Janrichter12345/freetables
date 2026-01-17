import { useParams, useNavigate } from "react-router-dom";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import ReserveModal from "../components/ReserveModal";

import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

import { ArrowLeft } from "lucide-react";

/* ================= Static Map Center Helper ================= */
function StaticCenter({ center, zoom = 16 }) {
  const map = useMap();

  useEffect(() => {
    if (Array.isArray(center) && center.length === 2) {
      map.setView(center, zoom, { animate: false });
    }
  }, [center, zoom, map]);

  return null;
}

/* ================= GPS Marker ================= */
const gpsPinIcon = L.divIcon({
  className: "",
  iconSize: [36, 44],
  iconAnchor: [18, 44],
  html: `
    <div style="width:36px;height:44px; pointer-events:none;">
      <svg width="36" height="44" viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg"
        style="filter: drop-shadow(0 6px 10px rgba(0,0,0,0.18));">
        <path d="M18 43C18 43 31 30.6 31 18C31 10.3 25.2 4 18 4C10.8 4 5 10.3 5 18C5 30.6 18 43 18 43Z"
          fill="#6F8F73" stroke="white" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="18" cy="18" r="5.5" fill="white" opacity="0.95"/>
      </svg>
    </div>
  `,
});

/* ================= Helpers ================= */
function normalizePdfUrl(raw) {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const parts = u.pathname.split("/").map((seg) => {
      if (!seg) return seg;
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch {
        return encodeURIComponent(seg);
      }
    });
    u.pathname = parts.join("/");
    return u.toString();
  } catch {
    return encodeURI(raw);
  }
}

function buildPdfProxyUrl(publicUrl) {
  try {
    const u = new URL(publicUrl);
    return `${u.origin}/functions/v1/pdf-proxy?url=${encodeURIComponent(publicUrl)}`;
  } catch {
    return "";
  }
}

/**
 * ✅ CRITICAL FIX:
 * pdf.js kann den ArrayBuffer an den Worker "transferieren" -> danach ist er detached/leer.
 * Darum: IMMER eine KOPIE übergeben, nie die gecachten Bytes direkt!
 */
function cloneBytesForPdfJs(bytes) {
  if (!bytes) return null;

  try {
    if (bytes instanceof Uint8Array) {
      // typed array slice() kopiert in neuen Buffer
      return bytes.slice();
    }
    if (bytes instanceof ArrayBuffer) {
      return new Uint8Array(bytes).slice();
    }

    // Fallback (z.B. falls was komisches reinkommt)
    return new Uint8Array(bytes).slice();
  } catch {
    return null;
  }
}

/* ================= PDF.js Loader (CDN) ================= */
const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

let _pdfJsPromise = null;

function ensurePdfJs() {
  if (typeof window === "undefined") return Promise.reject(new Error("no-window"));

  if (window.pdfjsLib) {
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
    } catch {}
    return Promise.resolve(window.pdfjsLib);
  }

  if (_pdfJsPromise) return _pdfJsPromise;

  _pdfJsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-pdfjs="1"]');
    if (existing) {
      const t = setInterval(() => {
        if (window.pdfjsLib) {
          clearInterval(t);
          try {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
          } catch {}
          resolve(window.pdfjsLib);
        }
      }, 50);

      setTimeout(() => {
        clearInterval(t);
        if (!window.pdfjsLib) reject(new Error("pdfjs-timeout"));
      }, 8000);

      return;
    }

    const s = document.createElement("script");
    s.src = PDFJS_CDN;
    s.async = true;
    s.dataset.pdfjs = "1";
    s.onload = () => {
      if (!window.pdfjsLib) return reject(new Error("pdfjs-missing"));
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
      } catch {}
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error("pdfjs-load-failed"));
    document.head.appendChild(s);
  });

  return _pdfJsPromise;
}

/* ================= PDF Bytes Cache ================= */
const _pdfBytesCache = new Map(); // url -> { bytes } | { error, ts } | { promise, ts }

/* ================= PDF Bytes Loader Hook (preload im Hintergrund) ================= */
function usePdfBytes(url) {
  const safeUrl = useMemo(() => normalizePdfUrl(url), [url]);
  const [state, setState] = useState({ status: "idle", bytes: null, error: null });

  useEffect(() => {
    let cancelled = false;

    if (!safeUrl) {
      setState({ status: "idle", bytes: null, error: null });
      return;
    }

    // 1) bytes cache
    const cached = _pdfBytesCache.get(safeUrl);
    if (cached?.bytes) {
      setState({ status: "ok", bytes: cached.bytes, error: null });
      ensurePdfJs().catch(() => {});
      return;
    }

    // 2) stale promise (verhindert "nie wieder lädt")
    if (cached?.promise) {
      const started = cached.ts || 0;
      if (Date.now() - started > 15000) _pdfBytesCache.delete(safeUrl);
    }

    // 3) error nur kurz cachen (sonst "für immer kaputt")
    const cached2 = _pdfBytesCache.get(safeUrl);
    if (cached2?.error) {
      const ts = cached2.ts || 0;
      if (Date.now() - ts < 8000) {
        setState({ status: "fail", bytes: null, error: cached2.error });
        return;
      }
      _pdfBytesCache.delete(safeUrl);
    }

    const fetchBytes = async (u) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => {
        try {
          ctrl.abort();
        } catch {}
      }, 12000);

      try {
        const res = await fetch(u, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        return new Uint8Array(ab);
      } finally {
        clearTimeout(t);
      }
    };

    const run = async () => {
      setState({ status: "loading", bytes: null, error: null });

      const again = _pdfBytesCache.get(safeUrl);
      if (again?.promise) {
        try {
          const b = await again.promise;
          if (!cancelled) {
            setState({ status: "ok", bytes: b, error: null });
            ensurePdfJs().catch(() => {});
          }
        } catch (e) {
          if (!cancelled) setState({ status: "fail", bytes: null, error: e });
        }
        return;
      }

      const p = (async () => {
        try {
          return await fetchBytes(safeUrl);
        } catch (e1) {
          const proxy = buildPdfProxyUrl(safeUrl);
          if (!proxy) throw e1;
          return await fetchBytes(proxy);
        }
      })();

      _pdfBytesCache.set(safeUrl, { promise: p, ts: Date.now() });

      try {
        const bytes = await p;
        _pdfBytesCache.set(safeUrl, { bytes });
        if (!cancelled) {
          setState({ status: "ok", bytes, error: null });
          ensurePdfJs().catch(() => {});
        }
      } catch (e) {
        // ✅ Fix: beim unmount nicht "Cache vergiften"
        if (cancelled) {
          _pdfBytesCache.delete(safeUrl);
          return;
        }

        const msg = String(e?.message || "").toLowerCase();
        if (e?.name === "AbortError" || msg.includes("aborted") || msg.includes("cancel")) {
          _pdfBytesCache.delete(safeUrl);
        } else {
          _pdfBytesCache.set(safeUrl, { error: e, ts: Date.now() });
        }

        setState({ status: "fail", bytes: null, error: e });
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [safeUrl]);

  return state;
}

/* ================= Error Boundary (verhindert "alles weiß") ================= */
class PdfErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err) {
    console.error("PDF crashed:", err);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="h-full w-full flex items-center justify-center p-6 text-[#7A8696] bg-[#F8F7F4]">
          <div className="max-w-md w-full bg-white rounded-2xl border border-[#E7E2D7] p-4">
            <div className="font-semibold text-[#2E2E2E]">PDF Anzeige ist abgestürzt</div>
            <div className="text-sm mt-1">Bitte Seite neu laden.</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ================= Inline PDF Viewer (Canvas / PDF.js) ================= */
function PdfCanvasViewer({ bytes, zoomPercent, onZoomPercentChange, scrollMemoryRef, gesturesEnabled }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | doc-loading | rendering | ok | fail
  const [sizeTick, setSizeTick] = useState(0);

  const zoomRef = useRef(zoomPercent);
  useEffect(() => {
    zoomRef.current = zoomPercent;
  }, [zoomPercent]);

  const pdfRef = useRef(null);
  const docTaskRef = useRef(null);

  const renderSeqRef = useRef(0);
  const renderTasksRef = useRef([]);

  const retryCountRef = useRef(0);
  const retryTimerRef = useRef(null);

  const clearRetry = () => {
    try {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    } catch {}
    retryTimerRef.current = null;
  };

  const cancelRenders = () => {
    const tasks = renderTasksRef.current;
    renderTasksRef.current = [];
    tasks.forEach((t) => {
      try {
        t?.cancel?.();
      } catch {}
    });
  };

  // resize -> neu rendern
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let raf = null;
    const bump = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setSizeTick((x) => x + 1));
    };

    bump();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => bump());
      ro.observe(el);
      return () => {
        if (raf) cancelAnimationFrame(raf);
        ro.disconnect();
      };
    }

    window.addEventListener("resize", bump);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", bump);
    };
  }, []);

  // gestures: ctrl+wheel / pinch -> % ändern
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!gesturesEnabled) return;

    const clamp = (v) => Math.max(50, Math.min(220, v));

    const pendingRef = { raf: 0, target: null };
    const commit = () => {
      pendingRef.raf = 0;
      if (pendingRef.target == null) return;
      const next = Math.round(pendingRef.target);
      pendingRef.target = null;
      onZoomPercentChange(next);
    };
    const schedule = (val) => {
      pendingRef.target = clamp(val);
      if (!pendingRef.raf) pendingRef.raf = requestAnimationFrame(commit);
    };

    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const cur = zoomRef.current || 100;
        const next = clamp(cur * Math.exp(-e.deltaY / 300));
        schedule(next);
      }
    };

    // Touch pinch
    const pinch = { active: false, startDist: 0, startZoom: 100 };

    const dist = (t1, t2) => {
      const dx = (t2.clientX || 0) - (t1.clientX || 0);
      const dy = (t2.clientY || 0) - (t1.clientY || 0);
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onTouchStart = (e) => {
      if (e.touches && e.touches.length === 2) {
        pinch.active = true;
        pinch.startDist = dist(e.touches[0], e.touches[1]);
        pinch.startZoom = zoomRef.current || 100;
      }
    };

    const onTouchMove = (e) => {
      if (!pinch.active) return;
      if (!e.touches || e.touches.length !== 2) return;
      e.preventDefault();

      const d = dist(e.touches[0], e.touches[1]);
      if (!pinch.startDist) return;

      const scale = d / pinch.startDist;
      const next = clamp(pinch.startZoom * scale);
      schedule(next);
    };

    const onTouchEnd = (e) => {
      if (!e.touches || e.touches.length < 2) pinch.active = false;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      try {
        if (pendingRef.raf) cancelAnimationFrame(pendingRef.raf);
      } catch {}
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [onZoomPercentChange, gesturesEnabled]);

  // scroll memory (Top + Left)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      if (scrollMemoryRef?.current) {
        scrollMemoryRef.current.top = el.scrollTop || 0;
        scrollMemoryRef.current.left = el.scrollLeft || 0;
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollMemoryRef]);

  // 1) Dokument 1x aus Bytes laden
  useEffect(() => {
    let cancelled = false;

    clearRetry();
    retryCountRef.current = 0;

    try {
      cancelRenders();
    } catch {}

    try {
      docTaskRef.current?.destroy?.();
    } catch {}
    docTaskRef.current = null;

    try {
      pdfRef.current?.destroy?.();
    } catch {}
    pdfRef.current = null;

    renderSeqRef.current += 1;

    const loadDoc = async () => {
      if (!bytes) return;

      setStatus("doc-loading");

      try {
        const pdfjsLib = await ensurePdfJs();
        if (cancelled) return;

        // ✅ FIX: Immer eine Kopie der Bytes an pdf.js geben!
        const dataCopy = cloneBytesForPdfJs(bytes);
        if (!dataCopy || dataCopy.byteLength === 0) {
          throw new Error("pdf-bytes-empty-or-detached");
        }

        const task = pdfjsLib.getDocument({
          data: dataCopy,
          disableRange: true,
          disableStream: true,
        });
        docTaskRef.current = task;

        const pdf = await task.promise;
        if (cancelled) return;

        pdfRef.current = pdf;
        setStatus("ok");

        requestAnimationFrame(() => {
          if (!cancelled) setSizeTick((x) => x + 1);
        });
      } catch (e) {
        if (cancelled) return;
        console.error("PDF doc load failed:", e);
        setStatus("fail");
      }
    };

    loadDoc();

    return () => {
      cancelled = true;
      clearRetry();
      try {
        cancelRenders();
      } catch {}
      try {
        docTaskRef.current?.destroy?.();
      } catch {}
      docTaskRef.current = null;

      try {
        pdfRef.current?.destroy?.();
      } catch {}
      pdfRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  // 2) Render bei Zoom/Resize
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const pdf = pdfRef.current;
      const el = containerRef.current;
      if (!pdf || !el) return;

      const cw0 = el.clientWidth || 0;
      const ch0 = el.clientHeight || 0;
      if (cw0 < 40 || ch0 < 40) {
        requestAnimationFrame(() => {
          if (!cancelled) setSizeTick((x) => x + 1);
        });
        return;
      }

      const mySeq = ++renderSeqRef.current;

      clearRetry();
      cancelRenders();
      setStatus((s) => (s === "doc-loading" ? s : "rendering"));

      const prevScrollableY = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
      const prevScrollableX = Math.max(0, (el.scrollWidth || 0) - (el.clientWidth || 0));
      const prevRatioY = prevScrollableY > 0 ? (el.scrollTop || 0) / prevScrollableY : null;
      const prevRatioX = prevScrollableX > 0 ? (el.scrollLeft || 0) / prevScrollableX : null;

      try {
        const frag = document.createDocumentFragment();

        const first = await pdf.getPage(1);
        if (cancelled || mySeq !== renderSeqRef.current) return;

        const vp1 = first.getViewport({ scale: 1 });

        const padding = 28;
        const cw = Math.max(1, el.clientWidth || 1);
        const fitWidthScale = (cw - padding) / vp1.width;

        const z = Number(zoomPercent) || 100;
        const baseScale = Math.max(0.2, Math.min(6, fitWidthScale * (z / 100)));

        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled || mySeq !== renderSeqRef.current) return;

          const page = pageNum === 1 ? first : await pdf.getPage(pageNum);
          if (cancelled || mySeq !== renderSeqRef.current) return;

          const viewport = page.getViewport({ scale: baseScale * dpr });
          const cssW = Math.floor(viewport.width / dpr);
          const cssH = Math.floor(viewport.height / dpr);

          const outer = document.createElement("div");
          outer.style.padding = "12px 0";
          outer.style.width = "100%";

          const inner = document.createElement("div");
          inner.style.width = `${cssW}px`;
          inner.style.margin = "0 auto";
          inner.style.display = "block";

          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) throw new Error("no-canvas-context");

          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);

          canvas.style.width = `${cssW}px`;
          canvas.style.height = `${cssH}px`;
          canvas.style.maxWidth = "none";
          canvas.style.maxHeight = "none";
          canvas.style.display = "block";
          canvas.style.borderRadius = "16px";
          canvas.style.background = "white";
          canvas.style.boxShadow = "0 8px 18px rgba(0,0,0,0.08)";

          inner.appendChild(canvas);
          outer.appendChild(inner);
          frag.appendChild(outer);

          const renderTask = page.render({ canvasContext: ctx, viewport });
          renderTasksRef.current.push(renderTask);

          try {
            await renderTask.promise;
          } catch (err) {
            if (err?.name === "RenderingCancelledException") return;
            if (String(err?.message || "").toLowerCase().includes("cancel")) return;
            throw err;
          }
        }

        if (cancelled || mySeq !== renderSeqRef.current) return;

        el.innerHTML = "";
        el.appendChild(frag);

        requestAnimationFrame(() => {
          if (cancelled || mySeq !== renderSeqRef.current) return;

          const nowScrollableY = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
          const nowScrollableX = Math.max(0, (el.scrollWidth || 0) - (el.clientWidth || 0));

          const memTop = Number(scrollMemoryRef?.current?.top || 0);
          const memLeft = Number(scrollMemoryRef?.current?.left || 0);

          el.scrollTop = prevRatioY != null && nowScrollableY > 0 ? prevRatioY * nowScrollableY : memTop;
          el.scrollLeft = prevRatioX != null && nowScrollableX > 0 ? prevRatioX * nowScrollableX : memLeft;

          if (scrollMemoryRef?.current) {
            scrollMemoryRef.current.top = el.scrollTop || 0;
            scrollMemoryRef.current.left = el.scrollLeft || 0;
          }
        });

        retryCountRef.current = 0;
        if (!cancelled && mySeq === renderSeqRef.current) setStatus("ok");
      } catch (e) {
        if (cancelled || mySeq !== renderSeqRef.current) return;
        console.error("PDF render failed:", e);

        if (retryCountRef.current < 2) {
          retryCountRef.current += 1;
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (!cancelled) setSizeTick((x) => x + 1);
          }, 350);
          return;
        }

        setStatus("fail");
      }
    };

    run();

    return () => {
      cancelled = true;
      clearRetry();
      cancelRenders();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomPercent, sizeTick, scrollMemoryRef, bytes, gesturesEnabled]);

  return (
    <div className="h-full w-full relative">
      <div
        ref={containerRef}
        className="h-full w-full overflow-auto"
        style={{ WebkitOverflowScrolling: "touch" }}
      />

      {(status === "doc-loading" || status === "rendering") && (
        <div className="absolute inset-0 flex items-center justify-center text-[#7A8696] bg-white/55 pointer-events-none">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-white border border-[#E7E2D7] shadow-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-[#6F8F73] animate-pulse" />
            PDF wird geladen…
          </div>
        </div>
      )}

      {status === "fail" && (
        <div className="absolute inset-0 flex items-center justify-center text-[#7A8696] bg-[#F8F7F4]">
          <div className="max-w-md w-full bg-white rounded-2xl border border-[#E7E2D7] p-4">
            <div className="font-semibold text-[#2E2E2E]">PDF konnte nicht angezeigt werden</div>
            <div className="text-sm mt-1">Bitte kurz warten und nochmal öffnen (oder Seite neu laden).</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= Smart PDF Viewer (Bytes + PDF.js) ================= */
function SmartPdfViewer({ url, zoomPercent, onZoomPercentChange, scrollMemoryRef, gesturesEnabled }) {
  const safeUrl = useMemo(() => normalizePdfUrl(url), [url]);
  const { status, bytes, error } = usePdfBytes(safeUrl);

  if (!safeUrl) {
    return (
      <div className="h-full w-full flex items-center justify-center text-[#9AA7B8] bg-[#F8F7F4]">
        Keine Speisekarte vorhanden.
      </div>
    );
  }

  if (status === "loading" || status === "idle") {
    return (
      <div className="h-full w-full flex items-center justify-center text-[#7A8696] bg-[#F8F7F4]">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-white border border-[#E7E2D7] shadow-sm">
          <span className="w-2.5 h-2.5 rounded-full bg-[#6F8F73] animate-pulse" />
          PDF lädt…
        </div>
      </div>
    );
  }

  if (status === "fail" || !bytes) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6 text-[#7A8696] bg-[#F8F7F4]">
        <div className="max-w-md w-full bg-white rounded-2xl border border-[#E7E2D7] p-4">
          <div className="font-semibold text-[#2E2E2E]">PDF kann nicht geladen werden</div>
          <div className="text-sm mt-1">Bitte deploye „pdf-proxy“ oder prüfe die PDF-URL.</div>
          {error ? (
            <div className="text-xs mt-2 text-[#9AA7B8] break-words">{String(error?.message || error)}</div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <PdfCanvasViewer
      bytes={bytes}
      zoomPercent={zoomPercent}
      onZoomPercentChange={onZoomPercentChange}
      scrollMemoryRef={scrollMemoryRef}
      gesturesEnabled={gesturesEnabled}
    />
  );
}

export default function RestaurantDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [restaurant, setRestaurant] = useState(null);
  const [activeTable, setActiveTable] = useState(null);

  const [showMenu, setShowMenu] = useState(false);
  const [menuOpenNonce, setMenuOpenNonce] = useState(0);

  const [gallery, setGallery] = useState([]);
  const [geo, setGeo] = useState({ status: "idle", lat: null, lng: null });

  const [googleRating, setGoogleRating] = useState({
    status: "idle",
    rating: null,
    total: null,
    place_id: null,
    name: null,
  });

  const loadReqRef = useRef(0);
  const ratingReqRef = useRef(0);
  const lastOkRatingRef = useRef(null);

  // Slideshow
  const [failedUrls, setFailedUrls] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const slideIndexRef = useRef(0);

  const [fadeToIndex, setFadeToIndex] = useState(null);
  const [isFading, setIsFading] = useState(false);

  // Viewer
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const touchStartX = useRef(null);

  // PDF Zoom + Scroll Memory
  const [pdfZoom, setPdfZoom] = useState(100); // 100% == fit-to-width
  const pdfScrollMemoryRef = useRef({ top: 0, left: 0 });

  useEffect(() => {
    slideIndexRef.current = slideIndex;
  }, [slideIndex]);

  useEffect(() => {
    setPdfZoom(100);
    pdfScrollMemoryRef.current = { top: 0, left: 0 };
    setShowMenu(false);
  }, [id]);

  const clampZoom = (z) => Math.max(50, Math.min(220, Math.round(Number(z) || 100)));

  const onPdfZoomChange = useCallback((z) => {
    setPdfZoom(clampZoom(z));
  }, []);

  const zoomOut = () => setPdfZoom((p) => clampZoom((Number(p) || 100) - 10));
  const zoomIn = () => setPdfZoom((p) => clampZoom((Number(p) || 100) + 10));
  const zoomReset = () => setPdfZoom(100);

  const closeMenu = () => setShowMenu(false);

  const markFailed = (url) => {
    if (!url) return;
    setFailedUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));
  };

  const preloadImage = (url) =>
    new Promise((resolve, reject) => {
      if (!url) return reject(new Error("no-url"));
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => reject(new Error("img-error"));
      img.src = url;
    });

  // Restaurant + Tische laden
  useEffect(() => {
    const myReq = ++loadReqRef.current;

    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("restaurants")
          .select(
            `
            id,
            name,
            address,
            description,
            image,
            lat,
            lng,
            phone,
            google_place_id,
            menu_pdf_url,
            tables (
              id,
              seats,
              status
            )
          `
          )
          .eq("id", id)
          .single();

        if (myReq !== loadReqRef.current) return;

        if (error || !data) {
          console.error("Supabase load error:", error);
          setRestaurant(false);
          return;
        }

        const freeTables = (data.tables || [])
          .filter((t) => t.status === "frei")
          .sort((a, b) => a.seats - b.seats);

        setRestaurant({ ...data, tables: freeTables });
        setGeo({ status: "idle", lat: null, lng: null });
      } catch (e) {
        console.error("Load crashed:", e);
        setRestaurant(false);
      }
    };

    load();
  }, [id]);

  // Galerie laden
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    setFailedUrls([]);
    setSlideIndex(0);
    setFadeToIndex(null);
    setIsFading(false);
    setViewerOpen(false);

    const loadGallery = async () => {
      try {
        const { data, error } = await supabase
          .from("restaurant_images")
          .select("id,url,sort,created_at")
          .eq("restaurant_id", id)
          .order("sort", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(10);

        if (cancelled) return;

        if (error) {
          console.warn("Gallery load error:", error);
          setGallery([]);
          return;
        }

        setGallery((data || []).filter((x) => x?.url).slice(0, 10));
      } catch (e) {
        if (!cancelled) {
          console.warn("Gallery crashed:", e);
          setGallery([]);
        }
      }
    };

    loadGallery();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const slideshowUrlsAll = useMemo(() => {
    const out = [];
    const pushUnique = (u) => {
      if (!u) return;
      if (!out.includes(u)) out.push(u);
    };
    pushUnique(restaurant?.image || null);
    (gallery || []).forEach((g) => pushUnique(g?.url || null));
    return out.filter(Boolean);
  }, [restaurant?.image, gallery]);

  const slideshowUrls = useMemo(() => {
    return slideshowUrlsAll.filter((u) => u && !failedUrls.includes(u));
  }, [slideshowUrlsAll, failedUrls]);

  useEffect(() => {
    if (slideshowUrlsAll.length > 0 && slideshowUrls.length === 0) setFailedUrls([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideshowUrlsAll.length, slideshowUrls.length]);

  useEffect(() => {
    if (!slideshowUrls.length) {
      setSlideIndex(0);
      setFadeToIndex(null);
      setIsFading(false);
      return;
    }
    setSlideIndex((prev) => Math.min(prev, slideshowUrls.length - 1));
    setViewerIndex((prev) => Math.min(prev, slideshowUrls.length - 1));
  }, [slideshowUrls.length]);

  const startTransitionTo = async (toIndex) => {
    if (!slideshowUrls.length) return;
    if (toIndex === slideIndexRef.current) return;
    if (isFading) return;

    const url = slideshowUrls[toIndex];
    try {
      await preloadImage(url);
    } catch {
      markFailed(url);
      return;
    }

    setFadeToIndex(toIndex);
    requestAnimationFrame(() => setIsFading(true));

    setTimeout(() => {
      setSlideIndex(toIndex);
      setFadeToIndex(null);
      setIsFading(false);
    }, 750);
  };

  useEffect(() => {
    if (slideshowUrls.length <= 1) return;
    if (viewerOpen) return;

    const t = setInterval(() => {
      const cur = slideIndexRef.current;
      const next = (cur + 1) % slideshowUrls.length;
      startTransitionTo(next);
    }, 10000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideshowUrls.length, viewerOpen]);

  const openViewer = (idx) => {
    if (!slideshowUrls.length) return;
    setViewerIndex(Math.max(0, Math.min(idx, slideshowUrls.length - 1)));
    setViewerOpen(true);
  };

  const closeViewer = () => setViewerOpen(false);

  const viewerPrev = () => {
    if (!slideshowUrls.length) return;
    setViewerIndex((p) => (p - 1 + slideshowUrls.length) % slideshowUrls.length);
  };

  const viewerNext = () => {
    if (!slideshowUrls.length) return;
    setViewerIndex((p) => (p + 1) % slideshowUrls.length);
  };

  useEffect(() => {
    if (!viewerOpen) return;

    const onKey = (e) => {
      if (e.key === "Escape") closeViewer();
      if (e.key === "ArrowLeft") viewerPrev();
      if (e.key === "ArrowRight") viewerNext();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerOpen, slideshowUrls.length]);

  const onTouchStart = (e) => {
    touchStartX.current = e.touches?.[0]?.clientX ?? null;
  };
  const onTouchEnd = (e) => {
    const startX = touchStartX.current;
    const endX = e.changedTouches?.[0]?.clientX ?? null;
    touchStartX.current = null;

    if (startX == null || endX == null) return;
    const dx = endX - startX;

    if (Math.abs(dx) < 50) return;
    if (dx > 0) viewerPrev();
    else viewerNext();
  };

  // ---- coords ----
  const parseCoord = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const dbCoords = useMemo(() => {
    if (!restaurant || restaurant === false) return { lat: null, lng: null, ok: false };

    const lat = parseCoord(restaurant.lat);
    const lng = parseCoord(restaurant.lng);

    const ok = lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

    return { lat, lng, ok };
  }, [restaurant]);

  // Geocode falls coords fehlen
  useEffect(() => {
    const geocode = async () => {
      if (!restaurant || restaurant === false) return;
      if (dbCoords.ok) return;
      if (!restaurant.address) return;
      if (geo.status === "loading" || geo.status === "ok") return;

      const cacheKey = `ft_geo_${restaurant.id}`;

      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const obj = JSON.parse(cached);
          if (obj?.lat && obj?.lng) {
            setGeo({ status: "ok", lat: obj.lat, lng: obj.lng });
            return;
          }
        }
      } catch (_) {}

      try {
        setGeo({ status: "loading", lat: null, lng: null });

        const q = encodeURIComponent(restaurant.address);
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`;

        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);

        const json = await res.json();
        const item = Array.isArray(json) ? json[0] : null;

        const lat = item ? Number(item.lat) : null;
        const lng = item ? Number(item.lon) : null;

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          setGeo({ status: "fail", lat: null, lng: null });
          return;
        }

        setGeo({ status: "ok", lat, lng });

        try {
          localStorage.setItem(cacheKey, JSON.stringify({ lat, lng }));
        } catch (_) {}

        supabase
          .from("restaurants")
          .update({ lat, lng })
          .eq("id", restaurant.id)
          .then(({ error }) => {
            if (error) console.warn("Supabase lat/lng update blocked:", error);
          });
      } catch (e) {
        console.error("Geocode failed:", e);
        setGeo({ status: "fail", lat: null, lng: null });
      }
    };

    geocode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant, dbCoords.ok]);

  // Google Rating
  useEffect(() => {
    if (!restaurant || restaurant === false) return;

    const myReq = ++ratingReqRef.current;

    const fetchGoogleRating = async () => {
      const name = typeof restaurant.name === "string" ? restaurant.name.trim() : "";
      const address = typeof restaurant.address === "string" ? restaurant.address.trim() : "";

      setGoogleRating((p) => ({ ...p, status: "loading" }));

      if (!name && !address) {
        if (myReq === ratingReqRef.current) {
          setGoogleRating((p) => (p.rating != null ? { ...p, status: "ok" } : { ...p, status: "fail" }));
        }
        return;
      }

      const cacheKey = `ft_google_rating_${restaurant.id}`;
      const TTL_MS = 6 * 60 * 60 * 1000;

      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const obj = JSON.parse(cached);
          if (obj?.ts && Date.now() - obj.ts < TTL_MS && typeof obj.rating === "number") {
            if (myReq === ratingReqRef.current) {
              const payload = {
                status: "ok",
                rating: obj.rating ?? null,
                total: obj.total ?? null,
                place_id: obj.place_id ?? null,
                name: obj.name ?? null,
              };
              lastOkRatingRef.current = payload;
              setGoogleRating(payload);
            }
            return;
          }
        }
      } catch (_) {}

      try {
        const { data, error } = await supabase.functions.invoke("google-rating", {
          body: { name, address },
        });

        if (myReq !== ratingReqRef.current) return;

        if (error || !data?.ok || !data?.found || typeof data.rating !== "number") {
          if (lastOkRatingRef.current?.rating != null) setGoogleRating(lastOkRatingRef.current);
          else setGoogleRating((p) => ({ ...p, status: "fail" }));
          return;
        }

        const payload = {
          status: "ok",
          rating: data.rating,
          total: typeof data.user_ratings_total === "number" ? data.user_ratings_total : null,
          place_id: data.place_id ?? null,
          name: data.name ?? null,
        };

        lastOkRatingRef.current = payload;
        setGoogleRating(payload);

        try {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              ts: Date.now(),
              rating: payload.rating,
              total: payload.total,
              place_id: payload.place_id,
              name: payload.name,
            })
          );
        } catch (_) {}
      } catch (e) {
        if (myReq !== ratingReqRef.current) return;
        if (lastOkRatingRef.current?.rating != null) setGoogleRating(lastOkRatingRef.current);
        else setGoogleRating((p) => ({ ...p, status: "fail" }));
      }
    };

    fetchGoogleRating();
  }, [restaurant?.id]);

  if (restaurant === null) return <div className="p-6 text-[#7A8696]">Restaurant wird geladen…</div>;
  if (restaurant === false) return <div className="p-6 text-[#7A8696]">Restaurant nicht gefunden.</div>;

  const menuUrlRaw = typeof restaurant.menu_pdf_url === "string" ? restaurant.menu_pdf_url : "";

  const openMenu = () => {
    pdfScrollMemoryRef.current = { top: 0, left: 0 };
    setMenuOpenNonce((x) => x + 1);
    setShowMenu(true);
  };

  const parseCoord2 = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const latDb = parseCoord2(restaurant.lat);
  const lngDb = parseCoord2(restaurant.lng);
  const finalLat = latDb != null ? latDb : geo.status === "ok" ? geo.lat : null;
  const finalLng = lngDb != null ? lngDb : geo.status === "ok" ? geo.lng : null;

  const hasCoords =
    finalLat !== null &&
    finalLng !== null &&
    finalLat >= -90 &&
    finalLat <= 90 &&
    finalLng >= -180 &&
    finalLng <= 180;

  const openGoogleRoute = () => {
    const name = typeof restaurant?.name === "string" ? restaurant.name.trim() : "";
    const address = typeof restaurant?.address === "string" ? restaurant.address.trim() : "";

    const placeIdDb = restaurant?.google_place_id ? String(restaurant.google_place_id).trim() : "";
    const placeIdFn = googleRating?.place_id ? String(googleRating.place_id).trim() : "";
    const placeId = placeIdDb || placeIdFn;

    const destText = `${name} ${address}`.trim();
    const destCoords = hasCoords ? `${finalLat},${finalLng}` : "";
    const destination = destText || destCoords;
    if (!destination) return;

    const webParams = new URLSearchParams();
    webParams.set("api", "1");
    webParams.set("travelmode", "driving");
    webParams.set("destination", destination);
    if (placeId) webParams.set("destination_place_id", placeId);
    const webUrl = `https://www.google.com/maps/dir/?${webParams.toString()}`;

    const ua = navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isAndroid = /Android/.test(ua);

    const qForApp = destText || destCoords || destination;

    if (isIOS) {
      const appUrl = `comgooglemaps://?daddr=${encodeURIComponent(qForApp)}&directionsmode=driving`;
      window.location.href = appUrl;
      setTimeout(() => (window.location.href = webUrl), 700);
      return;
    }

    if (isAndroid) {
      const appUrl = `google.navigation:q=${encodeURIComponent(qForApp)}&mode=d`;
      window.location.href = appUrl;
      setTimeout(() => (window.location.href = webUrl), 700);
      return;
    }

    window.location.href = webUrl;
  };

  const Stars = ({ value }) => {
    const v = Math.max(0, Math.min(5, Number(value) || 0));
    const full = Math.floor(v);
    const half = v - full >= 0.5;
    const empty = 5 - full - (half ? 1 : 0);

    return (
      <span className="inline-flex items-center gap-[3px] leading-none">
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

  const currentUrl = slideshowUrls[slideIndex] || null;
  const nextUrl = fadeToIndex != null && slideshowUrls[fadeToIndex] ? slideshowUrls[fadeToIndex] : null;

  const zoomLabel = `${Math.round(Number(pdfZoom) || 100)}%`;

  return (
    <div className="bg-[#F8F7F4] min-h-[calc(100dvh-112px)] sm:min-h-0 flex flex-col">
      {/* MOBILE TOP BAR */}
      <div className="sm:hidden shrink-0 px-4 pt-3 pb-3 bg-[#F8F7F4] border-b border-[#E7E2D7]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/restaurants")}
            className="w-10 h-10 rounded-full bg-white border border-[#E7E2D7] shadow-sm flex items-center justify-center active:scale-[0.98]"
            aria-label="Zurück"
            title="Zurück"
          >
            <ArrowLeft className="w-5 h-5 text-[#2E2E2E]" />
          </button>

          <div className="min-w-0">
            <div className="text-sm font-semibold text-[#2E2E2E] truncate">{restaurant.name}</div>
            {restaurant.address && <div className="text-xs text-[#9AA7B8] truncate">{restaurant.address}</div>}
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="flex-1 px-4 py-4 sm:py-8 pb-6">
        <div className="mx-auto w-full max-w-6xl">
          {/* DESKTOP Back */}
          <div className="hidden sm:flex items-center mb-4">
            <button
              type="button"
              onClick={() => navigate("/restaurants")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-[#E7E2D7] shadow-sm text-[#2E2E2E] font-semibold active:scale-[0.98]"
            >
              <ArrowLeft className="w-5 h-5" />
              Zurück
            </button>
          </div>

          <div className="bg-white rounded-3xl sm:rounded-[36px] shadow-sm border border-[#E7E2D7]/40 overflow-hidden">
            <div className="p-4 sm:p-8">
              <div className="flex flex-col lg:flex-row lg:items-start lg:gap-8">
                {/* FOTO */}
                <div className="order-1 lg:order-3 lg:w-[260px]">
                  <button
                    type="button"
                    onClick={() => openViewer(slideIndex)}
                    className="w-full h-[210px] sm:h-[280px] lg:h-[260px] rounded-3xl overflow-hidden bg-[#E7E2D7] relative transition-transform duration-150 active:scale-[0.99]"
                    title={slideshowUrls.length ? "Klicken: Fotos ansehen" : ""}
                  >
                    {!slideshowUrls.length ? (
                      <div className="w-full h-full flex items-center justify-center text-base text-[#9AA7B8]">
                        Kein Bild
                      </div>
                    ) : (
                      <>
                        <img
                          src={currentUrl}
                          alt={restaurant.name}
                          className="absolute inset-0 w-full h-full object-cover transition-all duration-700 ease-in-out"
                          style={{
                            opacity: isFading ? 0 : 1,
                            filter: isFading ? "blur(14px)" : "blur(0px)",
                            transform: isFading ? "scale(1.02)" : "scale(1)",
                          }}
                          onError={() => {
                            markFailed(currentUrl);
                            const idx = slideIndexRef.current;
                            const next = slideshowUrls.length > 1 ? (idx + 1) % slideshowUrls.length : idx;
                            setSlideIndex(next);
                          }}
                        />

                        {nextUrl && (
                          <img
                            src={nextUrl}
                            alt={restaurant.name}
                            className="absolute inset-0 w-full h-full object-cover transition-all duration-700 ease-in-out"
                            style={{
                              opacity: isFading ? 1 : 0,
                              filter: isFading ? "blur(0px)" : "blur(14px)",
                              transform: isFading ? "scale(1)" : "scale(1.02)",
                            }}
                            onError={() => markFailed(nextUrl)}
                          />
                        )}

                        <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-full bg-white/85 text-[#2E2E2E] text-xs font-semibold">
                          {slideshowUrls.length > 1 ? "Fotos" : "Foto"}
                        </div>
                      </>
                    )}
                  </button>
                </div>

                {/* TEXT */}
                <div className="order-2 lg:order-1 mt-4 lg:mt-0 flex-1 min-w-0">
                  <h1 className="hidden sm:block text-[36px] font-semibold text-[#2E2E2E] leading-tight">
                    {restaurant.name}
                  </h1>

                  {restaurant.description && (
                    <p className="mt-3 sm:mt-4 text-sm sm:text-xl text-[#7A8696] leading-relaxed">
                      {restaurant.description}
                    </p>
                  )}

                  {restaurant.address && (
                    <div className="mt-3 sm:mt-4 text-sm sm:text-lg text-[#9AA7B8] break-words">
                      📍 {restaurant.address}
                    </div>
                  )}

                  {/* GOOGLE RATING */}
                  <div className="mt-4">
                    {googleRating.status === "loading" ? (
                      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-[#F8F7F4] text-[#7A8696] text-sm">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#6F8F73] animate-pulse" />
                        Google Bewertung lädt…
                      </div>
                    ) : googleRating.status === "ok" && typeof googleRating.rating === "number" ? (
                      <div className="inline-flex items-center gap-3 px-4 py-2 rounded-2xl bg-[#F8F7F4] select-none">
                        <span className="text-[#2E2E2E] font-semibold text-sm sm:text-xl">
                          {googleRating.rating.toFixed(1)}
                        </span>

                        <span className="text-[#C7A24A] text-sm sm:text-xl">
                          <Stars value={googleRating.rating} />
                        </span>

                        {typeof googleRating.total === "number" && (
                          <span className="text-[#9AA7B8] text-xs sm:text-lg">({googleRating.total})</span>
                        )}

                        <span className="text-[#9AA7B8] text-xs sm:text-lg">·</span>

                        <span className="inline-flex items-center gap-2 text-[#9AA7B8] text-xs sm:text-lg">
                          <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white shadow-sm flex items-center justify-center text-[#2E2E2E] font-semibold">
                            G
                          </span>
                          Google
                        </span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-[#F8F7F4] text-[#9AA7B8] text-sm">
                        Google Bewertung aktuell nicht verfügbar
                      </div>
                    )}
                  </div>

                  {/* Speisekarte */}
                  <div className="mt-4 flex">
                    <button
                      type="button"
                      onClick={openMenu}
                      className="w-full sm:w-auto inline-flex items-center justify-center bg-[#A8BCA1]/25 text-[#6F8F73] font-semibold text-sm sm:text-lg px-5 py-3 rounded-2xl transition-transform duration-150 active:scale-[0.98]"
                    >
                      Speisekarte ansehen
                    </button>
                  </div>
                </div>

                {/* MAP (Button) */}
                <div className="order-3 lg:order-2 mt-4 lg:mt-0 lg:w-[380px]">
                  <button
                    type="button"
                    onClick={openGoogleRoute}
                    className="w-full h-[190px] sm:h-[240px] lg:h-[260px] rounded-3xl overflow-hidden bg-[#E7E2D7] relative z-0 border border-[#E7E2D7] transition-transform duration-150 active:scale-[0.99]"
                    title="Route planen"
                  >
                    {hasCoords ? (
                      <>
                        <div className="absolute inset-0 pointer-events-none">
                          <MapContainer
                            center={[finalLat, finalLng]}
                            zoom={16}
                            zoomControl={false}
                            attributionControl={false}
                            dragging={false}
                            scrollWheelZoom={false}
                            doubleClickZoom={false}
                            boxZoom={false}
                            keyboard={false}
                            touchZoom={false}
                            className="h-full w-full"
                            style={{ zIndex: 0 }}
                          >
                            <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
                            <StaticCenter center={[finalLat, finalLng]} zoom={16} />
                            <Marker position={[finalLat, finalLng]} icon={gpsPinIcon} />
                          </MapContainer>
                        </div>

                        <div className="absolute inset-0 bg-[#A8BCA1]/10 pointer-events-none" />

                        <div className="absolute bottom-3 left-3 px-4 py-2 rounded-full bg-white/90 text-[#2E2E2E] text-sm font-semibold pointer-events-none shadow-sm">
                          Route planen
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#9AA7B8] text-sm px-6 text-center">
                        {geo.status === "loading" ? "Karte wird geladen…" : "Keine Karte verfügbar"}
                      </div>
                    )}
                  </button>
                </div>
              </div>

              {/* TABLES */}
              <h3 className="mt-8 sm:mt-14 mb-1 text-lg sm:text-2xl font-semibold text-[#2E2E2E]">
                Verfügbare Tische
              </h3>
              <div className="text-xs sm:text-sm text-[#9AA7B8] mb-4 sm:mb-6">
                Tippe auf einen Tisch, um ihn zu reservieren.
              </div>

              <div className="space-y-3 sm:space-y-5">
                {(!restaurant.tables || restaurant.tables.length === 0) && (
                  <div className="text-[#9AA7B8] text-sm sm:text-base">Aktuell keine freien Tische</div>
                )}

                {(restaurant.tables || []).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTable(t)}
                    className="w-full flex items-center justify-between bg-[#F8F7F4] rounded-2xl px-4 sm:px-6 py-4 sm:py-6 transition-transform duration-150 active:scale-[0.985]"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-[#A8BCA1]/25 flex items-center justify-center text-[#6F8F73] font-semibold text-lg sm:text-2xl">
                        {t.seats}
                      </div>

                      <div className="text-left">
                        <div className="font-medium text-sm sm:text-xl">Tisch für {t.seats} Personen</div>
                        <div className="text-xs sm:text-base text-[#9AA7B8]">Jetzt verfügbar</div>
                      </div>
                    </div>

                    <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 bg-[#6F8F73] rounded-full" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FOTO VIEWER */}
      {viewerOpen && slideshowUrls.length > 0 && (
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center px-4" onClick={closeViewer}>
          <div
            className="relative w-full max-w-4xl"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div className="bg-black/30 rounded-3xl overflow-hidden">
              <img
                src={slideshowUrls[viewerIndex]}
                alt="Restaurant Foto"
                className="w-full max-h-[80vh] object-contain bg-black"
                onError={() => {
                  markFailed(slideshowUrls[viewerIndex]);
                  viewerNext();
                }}
              />
            </div>

            <button
              type="button"
              onClick={closeViewer}
              className="absolute top-3 right-3 bg-white/90 hover:bg-white text-[#2E2E2E] px-3 py-2 rounded-full font-semibold"
            >
              ✕
            </button>

            <div className="absolute bottom-3 left-3 bg-white/90 text-[#2E2E2E] px-3 py-2 rounded-full text-sm font-semibold">
              {viewerIndex + 1} / {slideshowUrls.length}
            </div>

            {slideshowUrls.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={viewerPrev}
                  className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white text-[#2E2E2E] w-12 h-12 rounded-full text-xl font-bold"
                  aria-label="Vorheriges Bild"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={viewerNext}
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white text-[#2E2E2E] w-12 h-12 rounded-full text-xl font-bold"
                  aria-label="Nächstes Bild"
                >
                  ›
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* SPEISEKARTE MODAL */}
      {showMenu && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center p-0 sm:px-4 bg-black/40"
          onClick={closeMenu}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white w-full h-[100dvh] rounded-none p-3 flex flex-col sm:h-[85vh] sm:max-w-6xl sm:rounded-3xl sm:p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top controls: Zoom mittig, Close rechts */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <div />

              <div className="justify-self-center max-w-full">
                <div className="bg-[#F8F7F4] rounded-2xl px-2 py-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={zoomOut}
                    className="w-9 h-9 rounded-xl bg-white shadow-sm text-[#2E2E2E] font-semibold"
                    aria-label="Verkleinern"
                  >
                    −
                  </button>

                  <button
                    type="button"
                    onClick={zoomReset}
                    className="h-9 min-w-[78px] px-3 rounded-xl bg-white shadow-sm text-[#2E2E2E] text-sm font-semibold"
                    aria-label="Zoom zurücksetzen"
                    title="Zoom zurücksetzen"
                  >
                    {zoomLabel}
                  </button>

                  <button
                    type="button"
                    onClick={zoomIn}
                    className="w-9 h-9 rounded-xl bg-white shadow-sm text-[#2E2E2E] font-semibold"
                    aria-label="Vergrößern"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="justify-self-end">
                <button
                  type="button"
                  onClick={closeMenu}
                  className="bg-[#F8F7F4] text-[#2E2E2E] px-3 py-2 rounded-2xl font-semibold transition-transform duration-150 active:scale-[0.985] whitespace-nowrap"
                  aria-label="Schließen"
                >
                  <span className="sm:hidden">✕</span>
                  <span className="hidden sm:inline">Schließen</span>
                </button>
              </div>
            </div>

            <div className="mt-3 flex-1 min-h-0">
              <div className="rounded-2xl overflow-hidden border border-[#E7E2D7] bg-[#F8F7F4] h-full relative">
                <PdfErrorBoundary>
                  <SmartPdfViewer
                    key={menuOpenNonce}
                    url={menuUrlRaw}
                    zoomPercent={pdfZoom}
                    onZoomPercentChange={onPdfZoomChange}
                    scrollMemoryRef={pdfScrollMemoryRef}
                    gesturesEnabled={true}
                  />
                </PdfErrorBoundary>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTable && <ReserveModal table={activeTable} restaurant={restaurant} onClose={() => setActiveTable(null)} />}
    </div>
  );
}
