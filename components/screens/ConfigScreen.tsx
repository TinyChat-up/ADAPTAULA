"use client";

import BrandLogo from "@/components/BrandLogo";
import type { Subject, SupportDegree } from "@/lib/adaptationRules";

type Perfil = "tea" | "tel" | "dislexia" | "di" | "tdah" | "retraso";

const PERFILES: { value: Perfil; label: string; desc: string; color: string }[] = [
  { value: "tea",      label: "TEA",      desc: "Trastorno del Espectro Autista",     color: "#7BAF7F" },
  { value: "tel",      label: "TEL",      desc: "Trastorno Específico del Lenguaje",  color: "#7BAF7F" },
  { value: "dislexia", label: "Dislexia", desc: "Dificultad lectora",                 color: "#7BAF7F" },
  { value: "di",       label: "DI",       desc: "Discapacidad intelectual",           color: "#7BAF7F" },
  { value: "tdah",     label: "TDAH",     desc: "Déficit de atención e hiperactividad", color: "#7BAF7F" },
  { value: "retraso",  label: "Retraso",  desc: "Retraso madurativo",                 color: "#7BAF7F" },
];

const ASIGNATURAS: { value: Subject; label: string }[] = [
  { value: "lengua",      label: "Lengua" },
  { value: "matematicas", label: "Matemáticas" },
  { value: "naturales",   label: "Naturales" },
  { value: "ingles",      label: "Inglés" },
  { value: "otra",        label: "Otra" },
];

const GRADOS: { value: SupportDegree; label: string; desc: string }[] = [
  { value: "leve",  label: "Leve",  desc: "Mejora visual, misma estructura" },
  { value: "medio", label: "Medio", desc: "Simplificación con apoyos" },
  { value: "alto",  label: "Alto",  desc: "Máximo andamiaje" },
];

interface Props {
  perfil: Perfil;
  subject: Subject;
  supportDegree: SupportDegree;
  interestsInput: string;
  educationalLevel: "primaria" | "secundaria";
  configError: string;
  showSecondaryWarning: boolean;
  onPerfilChange: (p: Perfil) => void;
  onSubjectChange: (s: Subject) => void;
  onSupportDegreeChange: (d: SupportDegree) => void;
  onInterestsChange: (v: string) => void;
  onEducationalLevelChange: (l: "primaria" | "secundaria") => void;
  onBack: () => void;
  onGenerate: () => void;
  onDismissWarning: () => void;
  onBackFromWarning: () => void;
}

export default function ConfigScreen({
  perfil,
  subject,
  supportDegree,
  interestsInput,
  educationalLevel,
  configError,
  showSecondaryWarning,
  onPerfilChange,
  onSubjectChange,
  onSupportDegreeChange,
  onInterestsChange,
  onEducationalLevelChange,
  onBack,
  onGenerate,
  onDismissWarning,
  onBackFromWarning,
}: Props) {
  /* ── Secondary warning gate ── */
  if (showSecondaryWarning) {
    return (
      <div className="aa-screen flex flex-col items-center justify-center px-4 py-14">
        <div className="w-full max-w-[540px] rounded-3xl border border-amber-300 bg-amber-50 p-8">
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full border border-amber-300 bg-amber-100">
            <svg className="h-5 w-5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
          </div>
          <p className="mt-3 text-base font-semibold text-amber-900">
            Este documento parece ser de Secundaria o ESO
          </p>
          <p className="mt-1.5 text-sm text-amber-800 leading-relaxed">
            AdaptAula está diseñado para Primaria (6–9 años). La adaptación puede no ser adecuada para este nivel educativo.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onDismissWarning}
              className="flex-1 rounded-full bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-800"
            >
              Continuar de todas formas
            </button>
            <button
              type="button"
              onClick={onBackFromWarning}
              className="flex-1 rounded-full border border-amber-300 bg-white px-5 py-2.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-50"
            >
              Volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="aa-screen px-4 py-10">
      <div className="mx-auto w-full max-w-[640px]">

        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition hover:bg-black/5"
            style={{ color: "var(--aa-text-muted)" }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Volver
          </button>
          <BrandLogo />
          <div className="w-16" />
        </div>

        {/* Title */}
        <h1 className="mb-8 text-2xl font-bold" style={{ color: "var(--aa-green-dark)" }}>
          Configura la adaptación
        </h1>

        {/* Etapa educativa */}
        <section className="mb-7" aria-labelledby="label-etapa">
          <p
            id="label-etapa"
            className="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--aa-text-muted)" }}
          >
            Etapa educativa
          </p>
          <div role="group" aria-labelledby="label-etapa" className="flex gap-2">
            {(["primaria", "secundaria"] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => onEducationalLevelChange(level)}
                aria-pressed={educationalLevel === level}
                className="rounded-full border px-4 py-1.5 text-sm font-medium transition"
                style={
                  educationalLevel === level
                    ? { background: "var(--aa-green)", borderColor: "var(--aa-green)", color: "#fff" }
                    : { background: "#fff", borderColor: "#c8dcc8", color: "var(--aa-text-muted)" }
                }
              >
                {level === "primaria" ? "Primaria (6–9 años)" : "Secundaria / ESO"}
              </button>
            ))}
          </div>
          {educationalLevel === "secundaria" && (
            <p className="mt-2 text-xs" style={{ color: "var(--aa-text-muted)" }}>
              Modo experimental — los perfiles NEE se aplican al nivel ESO
            </p>
          )}
        </section>

        {/* Perfil NEE */}
        <section className="mb-7" aria-labelledby="label-perfil">
          <p
            id="label-perfil"
            className="mb-1 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--aa-text-muted)" }}
          >
            Perfil del alumno <span aria-hidden="true" className="text-red-400">*</span>
          </p>
          <p id="hint-perfil" className="mb-3 text-xs" style={{ color: "var(--aa-text-muted)" }}>
            Selecciona el perfil que mejor describe las necesidades del alumno
          </p>
          <div
            role="radiogroup"
            aria-labelledby="label-perfil"
            aria-describedby="hint-perfil"
            aria-required="true"
            className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
          >
            {PERFILES.map(({ value, label, desc }) => {
              const selected = perfil === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onPerfilChange(value)}
                  className="flex cursor-pointer flex-col rounded-2xl border p-4 text-left transition"
                  style={
                    selected
                      ? {
                          borderColor: "var(--aa-green)",
                          background: "rgba(123,175,127,0.10)",
                          boxShadow: "0 0 0 1.5px var(--aa-green)",
                        }
                      : { borderColor: "#dde8dd", background: "#fff" }
                  }
                >
                  <span
                    className="mb-2 inline-block h-2 w-2 rounded-full"
                    style={{ background: selected ? "var(--aa-green)" : "#c8dcc8" }}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-bold" style={{ color: "var(--aa-text)" }}>
                    {label}
                  </span>
                  <span className="mt-0.5 text-xs leading-snug" style={{ color: "var(--aa-text-muted)" }}>
                    {desc}
                  </span>
                  {selected && (
                    <svg
                      className="mt-2 h-4 w-4 self-end"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                      style={{ color: "var(--aa-green)" }}
                    >
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Asignatura */}
        <section className="mb-7" aria-labelledby="label-asignatura">
          <p
            id="label-asignatura"
            className="mb-1 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--aa-text-muted)" }}
          >
            Materia <span aria-hidden="true" className="text-red-400">*</span>
          </p>
          <p id="hint-asignatura" className="mb-3 text-xs" style={{ color: "var(--aa-text-muted)" }}>
            Afecta al vocabulario y a las reglas de simplificación aplicadas
          </p>
          <div
            role="radiogroup"
            aria-labelledby="label-asignatura"
            aria-describedby="hint-asignatura"
            aria-required="true"
            className="flex flex-wrap gap-2"
          >
            {ASIGNATURAS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={subject === value}
                onClick={() => onSubjectChange(value)}
                className="rounded-full border px-4 py-1.5 text-sm font-medium transition"
                style={
                  subject === value
                    ? { background: "var(--aa-green)", borderColor: "var(--aa-green)", color: "#fff" }
                    : { background: "#fff", borderColor: "#c8dcc8", color: "var(--aa-text)" }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Grado */}
        <section className="mb-7" aria-labelledby="label-grado">
          <p
            id="label-grado"
            className="mb-1 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--aa-text-muted)" }}
          >
            Grado de adaptación <span aria-hidden="true" className="text-red-400">*</span>
          </p>
          <p id="hint-grado" className="mb-3 text-xs" style={{ color: "var(--aa-text-muted)" }}>
            Determina la cantidad de andamiaje y simplificación aplicada al material
          </p>
          <div
            role="radiogroup"
            aria-labelledby="label-grado"
            aria-describedby="hint-grado"
            aria-required="true"
            className="flex overflow-hidden rounded-full border"
            style={{ borderColor: "#c8dcc8" }}
          >
            {GRADOS.map(({ value, label, desc }, idx) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={supportDegree === value}
                onClick={() => onSupportDegreeChange(value)}
                className={`flex-1 py-2.5 text-sm font-semibold transition ${idx > 0 ? "border-l" : ""}`}
                style={
                  supportDegree === value
                    ? {
                        background: "var(--aa-orange)",
                        borderColor: "#c8dcc8",
                        color: "#fff",
                      }
                    : {
                        background: "#fff",
                        borderColor: "#c8dcc8",
                        color: "var(--aa-text-muted)",
                      }
                }
              >
                <span>{label}</span>
                <span className="sr-only"> — {desc}</span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs" style={{ color: "var(--aa-text-muted)" }} aria-live="polite">
            {GRADOS.find((g) => g.value === supportDegree)?.desc}
          </p>
        </section>

        {/* Intereses */}
        <section className="mb-8" aria-labelledby="label-intereses">
          <label
            id="label-intereses"
            htmlFor="input-intereses"
            className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--aa-text-muted)" }}
          >
            Intereses del alumno
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] font-normal normal-case"
              style={{ borderColor: "#c8dcc8", color: "var(--aa-text-muted)" }}
            >
              Opcional
            </span>
          </label>
          <input
            id="input-intereses"
            type="text"
            value={interestsInput}
            onChange={(e) => onInterestsChange(e.target.value)}
            placeholder="Ej: Pokémon, dinosaurios, fútbol..."
            aria-describedby="hint-intereses"
            className="w-full rounded-2xl border px-4 py-3 text-sm outline-none transition"
            style={{ borderColor: "#c8dcc8", background: "#fff", color: "var(--aa-text)" }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--aa-green)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(123,175,127,0.15)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "#c8dcc8";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
          <p id="hint-intereses" className="mt-1.5 text-xs" style={{ color: "var(--aa-text-muted)" }}>
            Los usamos para contextualizar ejemplos y hacer la adaptación más motivadora
          </p>
        </section>

        {/* Error */}
        {configError && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {configError}
          </div>
        )}

        {/* CTA */}
        <button
          type="button"
          onClick={onGenerate}
          className="w-full rounded-full py-4 text-sm font-bold text-white transition-all"
          style={{
            background: "linear-gradient(135deg, var(--aa-orange) 0%, #f0a060 100%)",
            boxShadow: "0 4px 18px rgba(232,131,74,0.32)",
          }}
        >
          Generar adaptación
        </button>
      </div>
    </div>
  );
}
