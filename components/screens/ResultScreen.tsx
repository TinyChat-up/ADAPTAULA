"use client";

import BrandLogo from "@/components/BrandLogo";
import PlanBadge from "@/components/ui/PlanBadge";
import type { Subject, SupportDegree } from "@/lib/adaptationRules";

type Perfil = "tea" | "tel" | "dislexia" | "di" | "tdah" | "retraso";

const PERFIL_LABELS: Record<Perfil, string> = {
  tea: "TEA", tel: "TEL", dislexia: "Dislexia",
  di: "DI", tdah: "TDAH", retraso: "Retraso",
};
const SUBJECT_LABELS: Record<Subject, string> = {
  lengua: "Lengua", matematicas: "Matemáticas",
  naturales: "Naturales", ingles: "Inglés", otra: "Otra",
};
const DEGREE_LABELS: Record<SupportDegree, string> = {
  leve: "Apoyo leve", medio: "Apoyo medio", alto: "Apoyo alto",
};

interface Props {
  cleanHtml: string;
  teacherNotes: string[];
  pdfBusy: boolean;
  docxBusy: boolean;
  docxError: string;
  notesOpen: boolean;
  perfil: Perfil;
  subject: Subject;
  supportDegree: SupportDegree;
  isPro?: boolean;
  onReset: () => void;
  onPdf: () => void;
  onDocx: () => void;
  onToggleNotes: () => void;
  onUpgrade?: () => void;
}

export default function ResultScreen({
  cleanHtml,
  teacherNotes,
  pdfBusy,
  docxBusy,
  docxError,
  notesOpen,
  perfil,
  subject,
  supportDegree,
  isPro,
  onReset,
  onPdf,
  onDocx,
  onToggleNotes,
  onUpgrade,
}: Props) {
  return (
    <div style={{ minHeight: "100svh", background: "#F0EDE8" }}>

      {/* ── Sticky header ── */}
      <div
        className="fixed inset-x-0 top-0 z-50 border-b"
        style={{ borderColor: "#ddd8d0", background: "rgba(250,247,242,0.92)", backdropFilter: "blur(12px)" }}
      >
        <div className="mx-auto flex max-w-[900px] items-center justify-between gap-4 px-4 py-3">

          {/* Left: back + context chips */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onReset}
              className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition hover:bg-black/5"
              style={{ color: "var(--aa-text-muted)" }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Nueva
            </button>
            <div className="hidden sm:flex items-center gap-1.5">
              {[PERFIL_LABELS[perfil], SUBJECT_LABELS[subject], DEGREE_LABELS[supportDegree]].map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border px-2.5 py-0.5 text-xs font-medium"
                  style={{ borderColor: "#c8dcc8", background: "rgba(123,175,127,0.10)", color: "var(--aa-green-dark)" }}
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>

          {/* Center: logo */}
          <div className="shrink-0">
            <BrandLogo />
          </div>

          {/* Right: plan badge (sm+) + download buttons */}
          <div className="flex items-center gap-3 shrink-0">
            {isPro !== undefined && (
              <div className="hidden sm:block">
                <PlanBadge plan={isPro ? "pro" : "free"} onUpgrade={!isPro ? onUpgrade : undefined} />
              </div>
            )}
            <button
              type="button"
              onClick={onPdf}
              disabled={pdfBusy}
              className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50"
              style={{ background: "var(--aa-green)" }}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" />
              </svg>
              {pdfBusy ? "..." : "PDF"}
            </button>
            <button
              type="button"
              onClick={onDocx}
              disabled={docxBusy}
              className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50"
              style={{ background: "var(--aa-orange)" }}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" />
              </svg>
              {docxBusy ? "..." : "DOCX"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="pt-[57px]">
        <div className="mx-auto max-w-[820px] px-4 py-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--aa-text-muted)" }}>
            Adaptación generada
          </p>
          <div dangerouslySetInnerHTML={{ __html: cleanHtml }} />
        </div>

        {/* Pro upsell banner — solo para usuarios free */}
        {!isPro && onUpgrade && (
          <div className="mx-auto max-w-[820px] px-4 pb-4">
            <div
              className="flex flex-col gap-3 rounded-2xl bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              style={{ border: "1px solid #E8E5E0", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
            >
              <div className="min-w-0">
                <span
                  className="mb-1.5 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
                  style={{ background: "var(--aa-orange)" }}
                >
                  Con Pro obtienes
                </span>
                <p className="text-sm font-medium" style={{ color: "var(--aa-text)" }}>
                  IA más precisa, PDF, DOCX y adaptaciones ilimitadas.
                </p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--aa-text-muted)" }}>
                  Tu adaptación gratuita ya está lista. Activa Pro para continuar.
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                <button
                  type="button"
                  onClick={onUpgrade}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90 active:scale-[0.98]"
                  style={{ background: "var(--aa-green-dark)" }}
                >
                  Ver plan Pro
                </button>
                <span className="text-[10px]" style={{ color: "var(--aa-text-muted)" }}>
                  9,99 €/mes · cancela cuando quieras
                </span>
              </div>
            </div>
          </div>
        )}

        {/* DOCX error */}
        {docxError && (
          <div className="mx-auto max-w-[820px] px-4 pb-4">
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {docxError}
            </p>
          </div>
        )}

        {/* Download CTA row (sticky bottom) */}
        <div
          className="sticky bottom-0 border-t"
          style={{ background: "rgba(250,247,242,0.95)", borderColor: "#ddd8d0", backdropFilter: "blur(10px)" }}
        >
          <div className="mx-auto flex max-w-[820px] items-center justify-center gap-3 px-4 py-4">
            <button
              type="button"
              onClick={onPdf}
              disabled={pdfBusy}
              className="flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
              style={{ background: "var(--aa-green)", boxShadow: "0 4px 12px rgba(123,175,127,0.30)" }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" />
              </svg>
              {pdfBusy ? "Preparando PDF..." : "Descargar PDF"}
            </button>
            <button
              type="button"
              onClick={onDocx}
              disabled={docxBusy}
              className="flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
              style={{ background: "var(--aa-orange)", boxShadow: "0 4px 12px rgba(232,131,74,0.28)" }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 2H4a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V7m-5-5l5 5m-5-5v5h5" />
              </svg>
              {docxBusy ? "Generando DOCX..." : "Descargar DOCX"}
            </button>
          </div>
        </div>

        {/* Teacher notes */}
        {teacherNotes.length > 0 && (
          <div className="mx-auto max-w-[820px] px-4 pb-16">
            <div className="rounded-2xl border border-amber-200 bg-amber-50">
              <button
                type="button"
                onClick={onToggleNotes}
                className="flex w-full items-center justify-between px-5 py-4"
              >
                <span className="text-sm font-semibold text-amber-800">
                  Notas para el docente
                  <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-xs text-amber-900">
                    {teacherNotes.length}
                  </span>
                </span>
                <svg
                  className={`h-4 w-4 text-amber-600 transition-transform ${notesOpen ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {notesOpen && (
                <ul className="space-y-2 border-t border-amber-200 px-5 py-4">
                  {teacherNotes.map((note, i) => (
                    <li key={i} className="flex gap-2 text-sm text-amber-900">
                      <span className="mt-0.5 shrink-0 text-amber-500">•</span>
                      {note}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
