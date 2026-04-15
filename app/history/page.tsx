"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import AuthNavButton from "@/components/AuthNavButton";
import { getUserAdaptations, type AdaptationItem } from "@/lib/adaptationsService";
import { getCurrentUser } from "@/lib/authService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Perfil = "tea" | "tel" | "dislexia" | "di" | "tdah" | "retraso";
type DateFilter = "7d" | "30d" | "all";

const PERFIL_LABELS: Record<string, string> = {
  tea: "TEA",
  tel: "TEL",
  dislexia: "Dislexia",
  di: "DI",
  tdah: "TDAH",
  retraso: "Retraso",
};

const PERFIL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  tea:      { bg: "rgba(123,175,127,0.15)", text: "#2d6b31", border: "rgba(123,175,127,0.4)" },
  tel:      { bg: "rgba(74,124,89,0.12)",  text: "#1e5c38", border: "rgba(74,124,89,0.3)" },
  dislexia: { bg: "rgba(232,131,74,0.12)", text: "#8f4a12", border: "rgba(232,131,74,0.3)" },
  di:       { bg: "rgba(11,79,179,0.10)",  text: "#0b4fb3", border: "rgba(11,79,179,0.25)" },
  tdah:     { bg: "rgba(155,48,48,0.10)",  text: "#7b1e1e", border: "rgba(155,48,48,0.25)" },
  retraso:  { bg: "rgba(100,80,160,0.10)", text: "#4a3a80", border: "rgba(100,80,160,0.25)" },
};

function formatDate(value: string): string {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function sourcePreview(item: AdaptationItem): string {
  const base = item.sourceText || "";
  const clean = base.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "Sin vista previa disponible.";
  return clean.length > 120 ? `${clean.slice(0, 120)}…` : clean;
}

function isWithinDays(isoDate: string, days: number): boolean {
  const ms = Date.now() - new Date(isoDate).getTime();
  return ms <= days * 24 * 60 * 60 * 1000;
}

// ─── Empty state SVG ──────────────────────────────────────────────────────────

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <svg width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="56" fill="rgba(123,175,127,0.10)" stroke="rgba(123,175,127,0.3)" strokeWidth="1.5" />
        <rect x="34" y="38" width="52" height="6" rx="3" fill="rgba(123,175,127,0.35)" />
        <rect x="34" y="50" width="38" height="5" rx="2.5" fill="rgba(123,175,127,0.25)" />
        <rect x="34" y="61" width="44" height="5" rx="2.5" fill="rgba(123,175,127,0.20)" />
        <circle cx="78" cy="78" r="18" fill="var(--aa-cream)" stroke="rgba(123,175,127,0.4)" strokeWidth="1.5" />
        <path d="M71 78h14M78 71v14" stroke="var(--aa-green)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <h3 className="mt-6 text-xl font-bold" style={{ color: "var(--aa-text)" }}>
        {hasFilter ? "Sin resultados para este filtro" : "Aún no tienes adaptaciones"}
      </h3>
      <p className="mt-2 max-w-xs text-sm leading-relaxed" style={{ color: "var(--aa-text-muted)" }}>
        {hasFilter
          ? "Prueba a cambiar los filtros o busca por otro término."
          : "Cuando generes tu primera adaptación aparecerá aquí para que puedas revisarla y reutilizarla."}
      </p>
      {!hasFilter && (
        <Link
          href="/"
          className="mt-6 rounded-full px-6 py-2.5 text-sm font-bold text-white transition-all"
          style={{ background: "linear-gradient(135deg, var(--aa-orange) 0%, #f0a060 100%)" }}
        >
          Crear primera adaptación
        </Link>
      )}
    </div>
  );
}

// ─── Result modal ─────────────────────────────────────────────────────────────

function ResultModal({ item, onClose }: { item: AdaptationItem; onClose: () => void }) {
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const perfil = item.studentProfile?.toLowerCase() ?? "";
  const colors = PERFIL_COLORS[perfil] ?? PERFIL_COLORS.tea;

  return (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Adaptación: ${item.title}`}
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      style={{ background: "rgba(44,59,45,0.45)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="relative flex w-full max-w-4xl flex-col rounded-3xl shadow-2xl"
        style={{ background: "var(--aa-cream)", maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b px-6 py-5" style={{ borderColor: "rgba(123,175,127,0.2)" }}>
          <div className="flex-1 pr-4">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-bold"
                style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
              >
                {PERFIL_LABELS[perfil] ?? perfil}
              </span>
              <span className="text-xs" style={{ color: "var(--aa-text-muted)" }}>
                {formatDate(item.createdAt)}
              </span>
            </div>
            <h2 className="text-lg font-bold leading-snug" style={{ color: "var(--aa-text)" }}>
              {item.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-black/5"
            style={{ color: "var(--aa-text-muted)" }}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {item.resultHtml ? (
            <iframe
              title={`Adaptación: ${item.title}`}
              srcDoc={item.resultHtml}
              className="h-full w-full"
              style={{ minHeight: "55vh", border: "none" }}
              sandbox="allow-same-origin"
            />
          ) : (
            <div className="flex items-center justify-center py-16 text-sm" style={{ color: "var(--aa-text-muted)" }}>
              Esta adaptación no tiene contenido HTML guardado.
            </div>
          )}
        </div>

        {/* Teacher notes */}
        {item.aiNotes && (
          <div className="border-t px-6 py-4" style={{ borderColor: "rgba(123,175,127,0.2)", background: "rgba(123,175,127,0.05)" }}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--aa-text-muted)" }}>
              Notas del docente
            </p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--aa-text)" }}>
              {item.aiNotes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function AdaptationCard({ item, onOpen }: { item: AdaptationItem; onOpen: (item: AdaptationItem) => void }) {
  const perfil = item.studentProfile?.toLowerCase() ?? "";
  const colors = PERFIL_COLORS[perfil] ?? PERFIL_COLORS.tea;
  const label = PERFIL_LABELS[perfil] ?? (item.studentProfile || "Sin perfil");

  return (
    <article
      className="group flex cursor-pointer flex-col gap-4 rounded-2xl border p-5 transition-all sm:flex-row sm:items-start"
      style={{
        background: "#fff",
        borderColor: "rgba(123,175,127,0.2)",
        boxShadow: "0 2px 12px rgba(44,59,45,0.04)",
      }}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpen(item); }}
      tabIndex={0}
      role="button"
      aria-label={`Ver adaptación: ${item.title}`}
    >
      {/* Profile badge column */}
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xs font-black"
        style={{ background: colors.bg, color: colors.text, border: `1.5px solid ${colors.border}` }}
      >
        {label.slice(0, 2).toUpperCase()}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-xs font-bold"
            style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
          >
            {label}
          </span>
          {item.workType && (
            <span className="text-xs" style={{ color: "var(--aa-text-muted)" }}>
              {item.workType}
            </span>
          )}
          <span className="ml-auto text-xs tabular-nums" style={{ color: "var(--aa-text-muted)" }}>
            {formatDate(item.createdAt)}
          </span>
        </div>

        <p className="mt-2 font-semibold leading-snug" style={{ color: "var(--aa-text)" }}>
          {item.title}
        </p>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--aa-text-muted)" }}>
          {sourcePreview(item)}
        </p>
      </div>

      {/* Arrow */}
      <div
        className="shrink-0 self-center opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
        style={{ color: "var(--aa-green)" }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 010-1.06z" clipRule="evenodd" />
        </svg>
      </div>
    </article>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [items, setItems] = useState<AdaptationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [search, setSearch] = useState("");
  const [perfilFilter, setPerfilFilter] = useState<Perfil | "all">("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [modalItem, setModalItem] = useState<AdaptationItem | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.replace("/login?next=/history");
          return;
        }
        const adaptations = await getUserAdaptations(user.id);
        setItems(adaptations);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "No se pudo cargar el historial.");
      } finally {
        setIsLoading(false);
        setAuthLoading(false);
      }
    };
    void bootstrap();
  }, [router]);

  const filtered = useMemo(() => {
    let list = items;

    // Date filter
    if (dateFilter === "7d") list = list.filter((i) => isWithinDays(i.createdAt, 7));
    else if (dateFilter === "30d") list = list.filter((i) => isWithinDays(i.createdAt, 30));

    // Profile filter
    if (perfilFilter !== "all") {
      list = list.filter((i) => i.studentProfile?.toLowerCase() === perfilFilter);
    }

    // Text search
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((i) => {
        const hay = [i.title, i.sourceText, i.studentProfile, i.workType]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    return list;
  }, [items, dateFilter, perfilFilter, search]);

  const hasFilter = perfilFilter !== "all" || dateFilter !== "all" || search.trim() !== "";

  if (authLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-sm"
        style={{ background: "var(--aa-cream)", color: "var(--aa-text-muted)" }}
      >
        Cargando sesión…
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--aa-cream)" }}>
      {/* Nav */}
      <nav
        className="sticky top-0 z-40 border-b"
        style={{
          background: "rgba(250,247,242,0.85)",
          borderColor: "rgba(123,175,127,0.18)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <Link href="/">
            <BrandLogo />
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="rounded-full px-3 py-1.5 text-sm transition hover:bg-black/5"
              style={{ color: "var(--aa-text-muted)" }}
            >
              Nueva adaptación
            </Link>
            <AuthNavButton
              loginClassName="rounded-full px-4 py-1.5 text-sm font-semibold transition hover:bg-black/5"
              logoutClassName="rounded-full px-4 py-1.5 text-sm font-semibold transition hover:bg-black/5"
            />
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-5 py-10">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: "var(--aa-green-dark)" }}>
            Historial
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--aa-text-muted)" }}>
            {items.length} {items.length === 1 ? "adaptación guardada" : "adaptaciones guardadas"}
          </p>
        </header>

        {/* Filters */}
        <section aria-label="Filtros" className="mb-6 space-y-3">
          {/* Search */}
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
              style={{ color: "var(--aa-text-muted)" }}
            >
              <circle cx="8.5" cy="8.5" r="5.25" />
              <path strokeLinecap="round" d="M14.5 14.5l3 3" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título, perfil o asignatura…"
              aria-label="Buscar adaptaciones"
              className="w-full rounded-full border py-2.5 pl-10 pr-4 text-sm outline-none transition"
              style={{
                background: "#fff",
                borderColor: "rgba(123,175,127,0.3)",
                color: "var(--aa-text)",
              }}
              onFocus={(e) => { e.currentTarget.style.boxShadow = "0 0 0 3px rgba(123,175,127,0.15)"; e.currentTarget.style.borderColor = "var(--aa-green)"; }}
              onBlur={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = "rgba(123,175,127,0.3)"; }}
            />
          </div>

          {/* Row: perfil + date */}
          <div className="flex flex-wrap gap-2">
            {/* Perfil filter */}
            <select
              value={perfilFilter}
              onChange={(e) => setPerfilFilter(e.target.value as Perfil | "all")}
              aria-label="Filtrar por perfil NEE"
              className="rounded-full border px-3 py-1.5 text-sm outline-none transition"
              style={{
                background: perfilFilter !== "all" ? "rgba(123,175,127,0.12)" : "#fff",
                borderColor: perfilFilter !== "all" ? "var(--aa-green)" : "rgba(123,175,127,0.3)",
                color: "var(--aa-text)",
              }}
            >
              <option value="all">Todos los perfiles</option>
              {(Object.keys(PERFIL_LABELS) as Perfil[]).map((p) => (
                <option key={p} value={p}>{PERFIL_LABELS[p]}</option>
              ))}
            </select>

            {/* Date filter */}
            {(["all", "30d", "7d"] as DateFilter[]).map((d) => {
              const label = d === "all" ? "Todas las fechas" : d === "30d" ? "Últimos 30 días" : "Últimos 7 días";
              const active = dateFilter === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDateFilter(d)}
                  className="rounded-full border px-3 py-1.5 text-sm transition"
                  style={
                    active
                      ? { background: "var(--aa-green)", borderColor: "var(--aa-green)", color: "#fff" }
                      : { background: "#fff", borderColor: "rgba(123,175,127,0.3)", color: "var(--aa-text-muted)" }
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Error */}
        {errorMessage && (
          <div
            className="mb-6 rounded-2xl border px-4 py-3 text-sm"
            style={{ background: "#fff1f2", borderColor: "#fecdd3", color: "#be123c" }}
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        {/* List */}
        <section aria-label="Lista de adaptaciones">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-24 animate-pulse rounded-2xl"
                  style={{ background: "rgba(123,175,127,0.08)" }}
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState hasFilter={hasFilter} />
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => (
                <AdaptationCard key={item.id} item={item} onOpen={setModalItem} />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Modal */}
      {modalItem && (
        <ResultModal item={modalItem} onClose={() => setModalItem(null)} />
      )}
    </div>
  );
}
