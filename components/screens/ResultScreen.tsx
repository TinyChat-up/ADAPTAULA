"use client";

import { useEffect, useRef, useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import FeedbackPanel from "@/app/components/feedback/FeedbackPanel";
import type { Subject, SupportDegree } from "@/lib/adaptationRules";

type Perfil = "tea" | "tel" | "dislexia" | "di" | "tdah" | "retraso";

export interface DocStyles {
  fontSize: number;
  fontFamily: string;
  lineHeight: string;
}

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

const FONT_FAMILIES = [
  { label: "Sans-serif",   value: "Arial, sans-serif" },
  { label: "Serif",        value: "Georgia, serif" },
  { label: "OpenDyslexic", value: "OpenDyslexic, sans-serif" },
] as const;

const LINE_HEIGHTS = [
  { label: "Normal",     value: "1.5" },
  { label: "Amplio",     value: "1.8" },
  { label: "Muy amplio", value: "2.2" },
] as const;

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
  onPdf: (styles: DocStyles) => void;
  onDocx: () => void;
  onToggleNotes: () => void;
  onUpgrade?: () => void;
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" />
    </svg>
  );
}

const BTN_BASE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  borderRadius: 6,
  border: "0.5px solid #E2DDD5",
  background: "#fff",
  color: "#5A5248",
  fontSize: 14,
  lineHeight: 1,
  cursor: "pointer",
  transition: "all 0.15s",
  flexShrink: 0,
};

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
  const chips = [SUBJECT_LABELS[subject], PERFIL_LABELS[perfil], DEGREE_LABELS[supportDegree]];

  // ── Toolbar state ─────────────────────────────────────────────────────────────
  const [fontSize,   setFontSize]   = useState(16);
  const [fontFamily, setFontFamily] = useState<string>("Arial, sans-serif");
  const [lineHeight, setLineHeight] = useState<string>("1.5");
  const [isEditing,  setIsEditing]  = useState(false);

  // ── Document container ref ────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);

  // Set innerHTML imperatively so React never touches the content on re-renders.
  // dangerouslySetInnerHTML is intentionally NOT used on the div — using it
  // alongside changing sibling props (style, contentEditable) causes React to
  // clear innerHTML during reconciliation whenever any component state changes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !cleanHtml) return;
    el.innerHTML = cleanHtml;
  }, [cleanHtml]);

  // Apply toolbar styles directly to the DOM node (no extra re-render needed)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.fontSize   = `${fontSize}px`;
    el.style.fontFamily = fontFamily;
    el.style.lineHeight = lineHeight;
  }, [fontSize, fontFamily, lineHeight]);

  // ── Feedback panel: show after a download completes ──────────────────────────
  const [showFeedback, setShowFeedback] = useState(false);
  const prevPdfBusy  = useRef(false);
  const prevDocxBusy = useRef(false);

  useEffect(() => {
    if (prevPdfBusy.current && !pdfBusy) setShowFeedback(true);
    prevPdfBusy.current = pdfBusy;
  }, [pdfBusy]);

  useEffect(() => {
    if (prevDocxBusy.current && !docxBusy) setShowFeedback(true);
    prevDocxBusy.current = docxBusy;
  }, [docxBusy]);

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function getDocStyles(): DocStyles {
    return { fontSize, fontFamily, lineHeight };
  }

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "#FEFCF9", position: "relative", overflow: "hidden" }}>
      {/* ── Ink blob background ── */}
      <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", width: 340, height: 340, top: -60, left: -80, background: "#E8834A", opacity: 0.06, filter: "blur(60px)", borderRadius: "50%", animation: "inkBg1 12s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: 280, height: 280, top: "30%", right: -60, background: "#4A7C59", opacity: 0.06, filter: "blur(60px)", borderRadius: "50%", animation: "inkBg2 14s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: 240, height: 240, bottom: 80, left: "25%", background: "#7CB9D6", opacity: 0.05, filter: "blur(60px)", borderRadius: "50%", animation: "inkBg1 10s ease-in-out infinite 2s" }} />
        <div style={{ position: "absolute", width: 200, height: 200, bottom: -40, right: "20%", background: "#E8834A", opacity: 0.05, filter: "blur(50px)", borderRadius: "50%", animation: "inkBg2 16s ease-in-out infinite 1s" }} />
        <div style={{ position: "absolute", width: 160, height: 160, top: "55%", left: "10%", background: "#4A7C59", opacity: 0.04, filter: "blur(45px)", borderRadius: "50%", animation: "inkBg1 18s ease-in-out infinite 3s" }} />
      </div>

      {/* ── Sticky header ── */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-6 py-3"
        style={{
          background: "rgba(254,252,249,0.93)",
          borderBottom: "0.5px solid #EDE8E0",
          backdropFilter: "blur(16px)",
        }}
      >
        {/* Left: back + chips */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onReset}
            className="flex shrink-0 items-center gap-1.5"
            style={{ fontSize: 12, color: "#8A8070", transition: "all 0.15s" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Nueva
          </button>
          <div className="hidden sm:block" style={{ width: 1, height: 14, background: "#E2DDD5" }} />
          <div className="hidden sm:flex items-center gap-1.5">
            {chips.map((chip, i) => (
              <span
                key={i}
                className="px-2 py-0.5"
                style={{ fontSize: 10, fontWeight: 500, borderRadius: 20, border: "0.5px solid #E2DDD5", color: "#5A5248", background: "#FAF8F5" }}
              >
                {chip}
              </span>
            ))}
          </div>
        </div>

        {/* Center: logo */}
        <BrandLogo compact />

        {/* Right: download buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onPdf(getDocStyles())}
            disabled={pdfBusy}
            className="flex items-center gap-1.5 text-white disabled:opacity-50"
            style={{ fontSize: 11, fontWeight: 500, padding: "7px 14px", borderRadius: 7, background: "#4A7C59", transition: "all 0.15s" }}
          >
            <DownloadIcon />
            {pdfBusy ? "..." : "PDF"}
          </button>
          <button
            type="button"
            onClick={onDocx}
            disabled={docxBusy}
            className="flex items-center gap-1.5 text-white disabled:opacity-50"
            style={{ fontSize: 11, fontWeight: 500, padding: "7px 14px", borderRadius: 7, background: "#E8834A", transition: "all 0.15s" }}
          >
            <DownloadIcon />
            {docxBusy ? "..." : "DOCX"}
          </button>
        </div>
      </nav>

      {/* ── Content ── */}
      <div className="relative z-10 flex-1 px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-[860px]">

          {/* Section label */}
          <p
            className="mb-3"
            style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.09em", color: "#B0A898" }}
          >
            Adaptación generada
          </p>

          {/* ── Editing toolbar ── */}
          <div
            className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5"
            style={{ background: "#fff", border: "0.5px solid #E2DDD5", borderRadius: 12 }}
          >
            {/* Font size */}
            <div className="flex items-center gap-1.5">
              <span style={{ fontSize: 10, fontWeight: 600, color: "#A09888", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                Tamaño
              </span>
              <button type="button" style={BTN_BASE} onClick={() => setFontSize((s) => Math.max(12, s - 1))}>−</button>
              <span style={{ fontSize: 11, fontWeight: 500, color: "#2C2620", minWidth: 30, textAlign: "center" }}>
                {fontSize}px
              </span>
              <button type="button" style={BTN_BASE} onClick={() => setFontSize((s) => Math.min(22, s + 1))}>+</button>
            </div>

            <div style={{ width: 1, height: 16, background: "#E2DDD5", flexShrink: 0 }} />

            {/* Font family */}
            <div className="flex items-center gap-1.5">
              <span style={{ fontSize: 10, fontWeight: 600, color: "#A09888", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                Fuente
              </span>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 7,
                  border: "0.5px solid #E2DDD5",
                  background: "#fff",
                  color: "#2C2620",
                  cursor: "pointer",
                }}
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            <div style={{ width: 1, height: 16, background: "#E2DDD5", flexShrink: 0 }} />

            {/* Line height */}
            <div className="flex items-center gap-1.5">
              <span style={{ fontSize: 10, fontWeight: 600, color: "#A09888", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                Interlineado
              </span>
              <div className="flex gap-1">
                {LINE_HEIGHTS.map((lh) => {
                  const active = lineHeight === lh.value;
                  return (
                    <button
                      key={lh.value}
                      type="button"
                      onClick={() => setLineHeight(lh.value)}
                      style={{
                        fontSize: 10,
                        fontWeight: active ? 600 : 400,
                        padding: "3px 9px",
                        borderRadius: 9999,
                        border: active ? "1.5px solid #E8834A" : "0.5px solid #E2DDD5",
                        background: active ? "rgba(232,131,74,0.06)" : "#fff",
                        color: active ? "#B85A20" : "#5A5248",
                        transition: "all 0.15s",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {lh.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Edit toggle — pushed to the right */}
            <div style={{ marginLeft: "auto" }}>
              <button
                type="button"
                onClick={() => setIsEditing((e) => !e)}
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: "4px 12px",
                  borderRadius: 7,
                  border: isEditing ? "1.5px solid #4A7C59" : "0.5px solid #E2DDD5",
                  background: isEditing ? "rgba(74,124,89,0.06)" : "#fff",
                  color: isEditing ? "#4A7C59" : "#5A5248",
                  transition: "all 0.15s",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {isEditing ? "✓ Listo" : "✏️ Editar texto"}
              </button>
            </div>
          </div>

          {/* ── Document card — A4-style ── */}
          <div
            className="mb-6"
            style={{
              background: "#ffffff",
              border: "0.5px solid #E8E3DC",
              borderRadius: 18,
              padding: "48px 56px",
              boxShadow: "0 2px 8px rgba(44,38,32,0.05), 0 8px 40px rgba(44,38,32,0.08)",
            }}
          >
            {/* Card meta header */}
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20, background: "#F0F7F2", color: "#4A7C59", border: "0.5px solid #C8DFD0" }}>
                {SUBJECT_LABELS[subject]}
              </span>
              <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 10px", borderRadius: 20, background: "#FAF8F5", color: "#5A5248", border: "0.5px solid #E2DDD5" }}>
                Perfil {PERFIL_LABELS[perfil]}
              </span>
              <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 10px", borderRadius: 20, background: "#FAF8F5", color: "#5A5248", border: "0.5px solid #E2DDD5" }}>
                {DEGREE_LABELS[supportDegree]}
              </span>
            </div>
            <div style={{ height: 1, background: "#F2EDE6", marginBottom: 32 }} />

            {/* Document HTML — editable when isEditing */}
            <div
              ref={containerRef}
              className="document-body"
              contentEditable={isEditing}
              suppressContentEditableWarning={true}
              style={{
                outline: isEditing ? "1px dashed #E8834A" : "none",
                borderRadius: isEditing ? 6 : 0,
                padding: isEditing ? 6 : 0,
                transition: "outline 0.15s, padding 0.15s",
              }}
            />
          </div>

          {/* Pro upsell banner */}
          {!isPro && onUpgrade && (
            <div
              className="mb-5"
              style={{
                background: "rgba(255,255,255,0.90)",
                border: "0.5px solid #E8E5E0",
                borderRadius: 14,
                padding: "20px 24px",
                boxShadow: "0 2px 12px rgba(44,38,32,0.05)",
              }}
            >
              <span
                className="mb-2 inline-block text-white"
                style={{ fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 20, background: "#E8834A" }}
              >
                Con Pro obtienes
              </span>
              <p className="mt-2" style={{ fontSize: 13, fontWeight: 500, color: "#2C2620" }}>
                IA más precisa, PDF, DOCX y adaptaciones ilimitadas.
              </p>
              <p className="mt-1" style={{ fontSize: 11, color: "#8A8070" }}>
                Tu adaptación gratuita ya está lista. Activa Pro para continuar.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onUpgrade}
                  className="text-white"
                  style={{ fontSize: 12, fontWeight: 500, padding: "8px 18px", borderRadius: 10, background: "#4A7C59", transition: "all 0.15s" }}
                >
                  Ver plan Pro
                </button>
                <span style={{ fontSize: 10, color: "#A09888" }}>9,99 €/mes · cancela cuando quieras</span>
              </div>
            </div>
          )}

          {/* DOCX error */}
          {docxError && (
            <div
              className="mb-5 text-sm"
              style={{ borderRadius: 10, border: "0.5px solid #f5c6c6", background: "#fef2f2", color: "#c53030", padding: "12px 16px" }}
            >
              {docxError}
            </div>
          )}

          {/* Teacher notes */}
          {teacherNotes.length > 0 && (
            <div
              className="mb-24"
              style={{ border: "0.5px solid #F5E6C8", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 6px rgba(44,38,32,0.04)" }}
            >
              <button
                type="button"
                onClick={onToggleNotes}
                className="flex w-full items-center justify-between px-5 py-3.5"
                style={{ background: "#FDFAF3", transition: "all 0.15s" }}
              >
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#E8834A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#5A5248" }}>Notas para el docente</span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: "#F5E6C8", color: "#8A7040" }}>
                    {teacherNotes.length}
                  </span>
                </div>
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A8070" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transition: "transform 0.2s", transform: notesOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {notesOpen && (
                <ul style={{ padding: "12px 18px", background: "#fff" }}>
                  {teacherNotes.map((note, i) => (
                    <li key={i} className="flex gap-2.5" style={{ fontSize: 13, color: "#5A5248", padding: "5px 0", lineHeight: 1.55 }}>
                      <span className="mt-0.5 shrink-0" style={{ color: "#E8834A" }}>•</span>
                      {note}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Sticky bottom bar ── */}
      <div
        className="sticky bottom-0 z-50"
        style={{ borderTop: "0.5px solid #EDE8E0", background: "rgba(254,252,249,0.97)", backdropFilter: "blur(12px)" }}
      >
        <div className="mx-auto flex max-w-[860px] items-center justify-center gap-3 px-6 py-3.5">
          <button
            type="button"
            onClick={() => onPdf(getDocStyles())}
            disabled={pdfBusy}
            className="flex items-center gap-2 text-white disabled:opacity-50"
            style={{ fontSize: 12, fontWeight: 500, padding: "10px 26px", borderRadius: 9, background: "#4A7C59", transition: "all 0.15s" }}
          >
            <DownloadIcon />
            {pdfBusy ? "Preparando PDF..." : "Descargar PDF"}
          </button>
          <button
            type="button"
            onClick={onDocx}
            disabled={docxBusy}
            className="flex items-center gap-2 text-white disabled:opacity-50"
            style={{ fontSize: 12, fontWeight: 500, padding: "10px 26px", borderRadius: 9, background: "#E8834A", transition: "all 0.15s" }}
          >
            <DownloadIcon />
            {docxBusy ? "Generando DOCX..." : "Descargar DOCX"}
          </button>
        </div>
      </div>

      {/* ── Feedback slide-up panel ── */}
      {showFeedback && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(44,38,32,0.35)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setShowFeedback(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              background: "#FEFCF9",
              borderRadius: "16px 16px 0 0",
              border: "0.5px solid #E2DDD5",
              borderBottom: "none",
              maxHeight: "85vh",
              overflowY: "auto",
              animation: "slideUp 0.22s ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "0.5px solid #EDE8E0" }}
            >
              <p style={{ fontSize: 13, fontWeight: 500, color: "#2C2620" }}>
                ¿Cómo ha ido la adaptación?
              </p>
              <button
                type="button"
                onClick={() => setShowFeedback(false)}
                className="flex items-center justify-center"
                style={{ width: 28, height: 28, borderRadius: 7, border: "0.5px solid #E2DDD5", background: "#fff", color: "#8A8070", transition: "all 0.15s" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <FeedbackPanel
              subject={subject}
              supportDegree={supportDegree}
              learningProfile={perfil}
              onComplete={() => setShowFeedback(false)}
            />
          </div>
        </div>
      )}

      <style>{`
        .document-body {
          font-size: 16px;
          line-height: 1.75;
          color: #2C2620;
        }
        .document-body h1 { font-size: 1.45em; font-weight: 600; color: #1A1612; margin-bottom: 0.4em; line-height: 1.25; }
        .document-body h2 { font-size: 1.2em;  font-weight: 600; color: #2C2620; margin-top: 1.4em; margin-bottom: 0.5em; }
        .document-body h3 { font-size: 1.05em; font-weight: 600; color: #2C2620; margin-top: 1.2em; margin-bottom: 0.4em; }
        .document-body p  { margin-bottom: 0.85em; }
        .document-body ul,
        .document-body ol { padding-left: 1.4em; margin-bottom: 0.85em; }
        .document-body li { margin-bottom: 0.3em; }

        @keyframes slideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes inkBg1 {
          0%,100% { transform: translate(0,0) scale(1); border-radius: 42% 58% 55% 45% / 50% 45% 55% 50%; }
          33%  { transform: translate(20px,-15px) scale(1.1); border-radius: 55% 45% 40% 60% / 45% 55% 50% 50%; }
          66%  { transform: translate(-15px,10px) scale(0.95); border-radius: 48% 52% 58% 42% / 55% 42% 58% 45%; }
        }
        @keyframes inkBg2 {
          0%,100% { transform: translate(0,0) scale(1); border-radius: 45% 55% 50% 50% / 50% 45% 55% 50%; }
          50%  { transform: translate(-20px,20px) scale(1.15); border-radius: 58% 42% 45% 55% / 42% 58% 50% 50%; }
        }
      `}</style>
    </div>
  );
}
