"use client";

import { useState } from "react";

export interface FeedbackPanelProps {
  adaptationId?: string;
  subject?: string;
  supportDegree?: string;
  learningProfile?: string;
  onComplete?: () => void;
}

type Usable = "yes" | "partial" | "no";

const CHIPS = [
  { value: "vocabulario",   label: "Vocabulario",   emoji: "📝" },
  { value: "instrucciones", label: "Instrucciones",  emoji: "📋" },
  { value: "pictogramas",   label: "Pictogramas",    emoji: "🖼️" },
  { value: "estructura",    label: "Estructura",     emoji: "🗂️" },
  { value: "nivel",         label: "Nivel",          emoji: "📊" },
  { value: "actividades",   label: "Actividades",    emoji: "✏️" },
] as const;

const USABLE_OPTIONS: { value: Usable; label: string }[] = [
  { value: "yes",     label: "Sí, directamente" },
  { value: "partial", label: "Con ajustes" },
  { value: "no",      label: "No era adecuada" },
];

function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5 mb-6">
      {[1, 2, 3].map((s) => (
        <div
          key={s}
          style={{
            height: 6,
            width: s === step ? 20 : 6,
            borderRadius: 9999,
            background: s === step ? "#E8834A" : "#E2DDD5",
            transition: "all 0.2s",
          }}
        />
      ))}
    </div>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          style={{ fontSize: 28, color: n <= (hover || value) ? "#E8834A" : "#E2DDD5", transition: "color 0.1s", lineHeight: 1 }}
          aria-label={`${n} estrella${n > 1 ? "s" : ""}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function Chip({
  label,
  emoji,
  selected,
  color,
  onClick,
}: {
  label: string;
  emoji: string;
  selected: boolean;
  color: "green" | "red";
  onClick: () => void;
}) {
  const activeColor = color === "green" ? "#4A7C59" : "#C53030";
  const activeBg   = color === "green" ? "#F0F7F2" : "#FEF2F2";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm"
      style={{
        borderRadius: 9999,
        border: selected ? `1.5px solid ${activeColor}` : "0.5px solid #E2DDD5",
        background: selected ? activeBg : "#fff",
        color: selected ? activeColor : "#5A5248",
        fontWeight: selected ? 500 : 400,
        transition: "all 0.15s",
      }}
    >
      <span style={{ fontSize: 14 }}>{emoji}</span>
      {label}
    </button>
  );
}

export default function FeedbackPanel({
  adaptationId,
  subject,
  supportDegree,
  learningProfile,
  onComplete,
}: FeedbackPanelProps) {
  const [step, setStep] = useState(1);
  const [rating, setRating] = useState(0);
  const [usable, setUsable] = useState<Usable | null>(null);
  const [positiveDimensions, setPositiveDimensions] = useState<string[]>([]);
  const [improvementDimensions, setImprovementDimensions] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleChip(value: string, list: string[], setList: (v: string[]) => void) {
    setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          usable,
          positive_dimensions: positiveDimensions,
          improvement_dimensions: improvementDimensions,
          improvement_notes: notes.trim() || undefined,
          adaptationId,
          subject,
          supportDegree,
          learningProfile,
        }),
      });
      if (!res.ok) {
        const json = await res.json() as Record<string, unknown>;
        throw new Error(typeof json.error === "string" ? json.error : "Error al enviar");
      }
      setSubmitted(true);
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 py-8 text-center"
        style={{ background: "#FEFCF9" }}
      >
        <div
          className="flex items-center justify-center"
          style={{ width: 44, height: 44, borderRadius: "50%", background: "#F0F7F2", border: "0.5px solid #C8DFD0" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <p style={{ fontSize: 14, fontWeight: 500, color: "#2C2620" }}>¡Gracias por tu feedback!</p>
        <p style={{ fontSize: 12, color: "#8A8070" }}>Tu valoración nos ayuda a mejorar las adaptaciones.</p>
      </div>
    );
  }

  return (
    <div style={{ background: "#FEFCF9", padding: "20px 24px" }}>
      <ProgressDots step={step} />

      {/* ── Step 1 ── */}
      {step === 1 && (
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "#A09888" }}>
              Valoración general
            </p>
            <StarRating value={rating} onChange={setRating} />
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "#A09888" }}>
              ¿Se ha podido usar con el alumno?
            </p>
            <div className="flex flex-col gap-1.5">
              {USABLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setUsable(opt.value)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-left"
                  style={{
                    borderRadius: 9,
                    border: usable === opt.value ? "1.5px solid #E8834A" : "0.5px solid #E2DDD5",
                    background: usable === opt.value ? "rgba(232,131,74,0.06)" : "#fff",
                    color: usable === opt.value ? "#B85A20" : "#5A5248",
                    fontWeight: usable === opt.value ? 500 : 400,
                    transition: "all 0.15s",
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: usable === opt.value ? "4px solid #E8834A" : "1.5px solid #C8C0B4",
                      flexShrink: 0,
                      transition: "all 0.15s",
                    }}
                  />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStep(2)}
            disabled={rating === 0 || usable === null}
            className="flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            style={{ borderRadius: 9, background: "#E8834A", transition: "all 0.15s" }}
          >
            Siguiente
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Step 2 ── */}
      {step === 2 && (
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "#A09888" }}>
              ¿Qué está bien?
            </p>
            <div className="flex flex-wrap gap-2">
              {CHIPS.map(({ value, label, emoji }) => (
                <Chip
                  key={value}
                  label={label}
                  emoji={emoji}
                  selected={positiveDimensions.includes(value)}
                  color="green"
                  onClick={() => toggleChip(value, positiveDimensions, setPositiveDimensions)}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "#A09888" }}>
              ¿Qué necesita mejorar?
            </p>
            <div className="flex flex-wrap gap-2">
              {CHIPS.map(({ value, label, emoji }) => (
                <Chip
                  key={value}
                  label={label}
                  emoji={emoji}
                  selected={improvementDimensions.includes(value)}
                  color="red"
                  onClick={() => toggleChip(value, improvementDimensions, setImprovementDimensions)}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex items-center gap-1 py-2.5 px-4 text-sm"
              style={{ borderRadius: 9, border: "0.5px solid #E2DDD5", color: "#8A8070", transition: "all 0.15s" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Atrás
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-white"
              style={{ borderRadius: 9, background: "#E8834A", transition: "all 0.15s" }}
            >
              Siguiente
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3 ── */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="feedback-notes"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
              style={{ color: "#A09888" }}
            >
              Comentario <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(opcional)</span>
            </label>
            <textarea
              id="feedback-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Las instrucciones son demasiado largas para este perfil..."
              className="w-full resize-none text-sm outline-none"
              style={{
                borderRadius: 9,
                border: "0.5px solid #E2DDD5",
                background: "#fff",
                padding: "10px 12px",
                color: "#2C2620",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "#E8834A"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "#E2DDD5"; }}
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: "#C53030" }}>{error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="flex items-center gap-1 py-2.5 px-4 text-sm"
              style={{ borderRadius: 9, border: "0.5px solid #E2DDD5", color: "#8A8070", transition: "all 0.15s" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Atrás
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              style={{ borderRadius: 9, background: "#4A7C59", transition: "all 0.15s" }}
            >
              {submitting ? (
                "Enviando…"
              ) : (
                <>
                  Enviar feedback
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
