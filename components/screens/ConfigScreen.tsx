"use client";

import type { Subject, SupportDegree, LearningProfile } from "@/lib/adaptationRules";
import BrandLogo from "@/components/BrandLogo";

const ASIGNATURAS: { value: Subject; label: string; icon: string }[] = [
  { value: "lengua",      label: "Lengua",       icon: "📖" },
  { value: "matematicas", label: "Matemáticas",  icon: "🔢" },
  { value: "naturales",   label: "Naturales",    icon: "🌿" },
  { value: "ingles",      label: "Inglés",       icon: "🌍" },
  { value: "otra",        label: "Otra",         icon: "📚" },
];

const PERFILES_NEE = [
  {
    id: "tdah" as LearningProfile,
    sigla: "TDAH",
    descripcion: "Le cuesta mantener la atención y terminar las tareas",
    detalle: "Fragmentación en pasos cortos, checkboxes y máximo 3 actividades",
    color: "#E8834A",
    bg: "#FFF5EF",
  },
  {
    id: "dislexia" as LearningProfile,
    sigla: "Dislexia",
    descripcion: "Tiene dificultades para leer y escribir con fluidez",
    detalle: "Párrafos cortos, sílabas clave destacadas y espaciado generoso",
    color: "#4A7C59",
    bg: "#F0F7F2",
  },
  {
    id: "tea" as LearningProfile,
    sigla: "TEA",
    descripcion: "Necesita rutinas claras y lenguaje muy literal",
    detalle: "Estructura predecible, pictogramas en cada instrucción y anticipación",
    color: "#7B6FA0",
    bg: "#F4F2F9",
  },
  {
    id: "tel" as LearningProfile,
    sigla: "TEL",
    descripcion: "Le cuesta comprender y expresarse con el lenguaje oral y escrito",
    detalle: "Frases de máximo 10 palabras, sujeto explícito y vocabulario clave en caja",
    color: "#4A7C8F",
    bg: "#F0F6F8",
  },
  {
    id: "di" as LearningProfile,
    sigla: "DI",
    descripcion: "Necesita vocabulario sencillo y ejemplos muy concretos",
    detalle: "Máximo 2 actividades, ejemplo resuelto previo y frases de 8 palabras",
    color: "#8F6B4A",
    bg: "#F8F3EE",
  },
  {
    id: "retraso" as LearningProfile,
    sigla: "Ret. Mad.",
    descripcion: "Su desarrollo está por debajo del nivel esperado para su edad",
    detalle: "Nivel -2 años, contextos cercanos y pictogramas en todo el documento",
    color: "#6B8F4A",
    bg: "#F2F7EE",
  },
];

const GRADOS: { value: SupportDegree; label: string; desc: string }[] = [
  { value: "leve",  label: "Leve",  desc: "Mejora visual, misma estructura" },
  { value: "medio", label: "Medio", desc: "Simplificación con apoyos" },
  { value: "alto",  label: "Alto",  desc: "Máximo andamiaje" },
];

interface Props {
  perfiles: LearningProfile[];
  subject: Subject;
  supportDegree: SupportDegree;
  interestsInput: string;
  educationalLevel: "primaria" | "secundaria";
  configError: string;
  showSecondaryWarning: boolean;
  onPerfilesChange: (p: LearningProfile[]) => void;
  onSubjectChange: (s: Subject) => void;
  onSupportDegreeChange: (d: SupportDegree) => void;
  onInterestsChange: (v: string) => void;
  onEducationalLevelChange: (l: "primaria" | "secundaria") => void;
  onBack: () => void;
  onGenerate: () => void;
  onDismissWarning: () => void;
  onBackFromWarning: () => void;
}

function SparklesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z" />
    </svg>
  );
}

function Divider() {
  return <div className="my-5" style={{ height: 0.5, background: "#EDE8E0" }} />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#A09888" }}>
      {children}
    </p>
  );
}

export default function ConfigScreen({
  perfiles,
  subject,
  supportDegree,
  interestsInput,
  educationalLevel: _educationalLevel,
  configError,
  showSecondaryWarning,
  onPerfilesChange,
  onSubjectChange,
  onSupportDegreeChange,
  onInterestsChange,
  onEducationalLevelChange: _onEducationalLevelChange,
  onBack,
  onGenerate,
  onDismissWarning,
  onBackFromWarning,
}: Props) {
  function togglePerfil(p: LearningProfile) {
    if (perfiles.includes(p)) {
      const next = perfiles.filter((x) => x !== p);
      onPerfilesChange(next.length > 0 ? next : perfiles);
    } else {
      onPerfilesChange([...perfiles, p]);
    }
  }

  /* ── Secondary warning gate ── */
  if (showSecondaryWarning) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-4"
        style={{ background: "#FEFCF9" }}
      >
        <div
          className="w-full max-w-[540px] p-8"
          style={{ borderRadius: 14, border: "0.5px solid #E2DDD5", background: "#fff" }}
        >
          <div
            className="mb-1 flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: "#FEF3EC", border: "0.5px solid #E8834A" }}
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="#E8834A">
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <p className="mt-3" style={{ fontSize: 15, fontWeight: 500, color: "#2C2620" }}>
            Este documento parece ser de Secundaria o ESO
          </p>
          <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "#8A8070" }}>
            AdaptAula está diseñado para Primaria (6–9 años). La adaptación puede no ser
            adecuada para este nivel educativo.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={onDismissWarning}
              className="flex-1 py-2.5 text-sm font-medium text-white"
              style={{ background: "#E8834A", borderRadius: 10, transition: "all 0.15s" }}
            >
              Continuar de todas formas
            </button>
            <button
              type="button"
              onClick={onBackFromWarning}
              className="flex-1 py-2.5 text-sm font-medium"
              style={{ border: "0.5px solid #E2DDD5", borderRadius: 10, color: "#8A8070", transition: "all 0.15s" }}
            >
              Volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "#FEFCF9" }}>
      {/* ── Nav top ── */}
      <nav
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "0.5px solid #EDE8E0" }}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1"
          style={{ fontSize: 12, color: "#8A8070", transition: "all 0.15s" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Volver
        </button>
        <BrandLogo compact />
        <div
          className="flex items-center gap-1.5 px-2.5 py-1"
          style={{ background: "#F2EEE8", borderRadius: 6, fontSize: 11, color: "#8A8070" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          documento
        </div>
      </nav>

      {/* ── Body ── */}
      <div className="flex-1 px-4 py-6">
        <div className="mx-auto w-full max-w-[560px]">

          {/* SECTION 1 — Asignatura */}
          <SectionLabel>Asignatura</SectionLabel>
          <div className="grid grid-cols-5 gap-1.5 mb-1">
            {ASIGNATURAS.map(({ value, label, icon }) => {
              const sel = subject === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onSubjectChange(value)}
                  className="flex flex-col items-center gap-1 py-2.5 px-1"
                  style={{
                    borderRadius: 10,
                    border: sel ? "1.5px solid #E8834A" : "0.5px solid #E2DDD5",
                    background: sel ? "rgba(232,131,74,0.06)" : "#fff",
                    transition: "all 0.15s",
                  }}
                >
                  <span style={{ fontSize: 18 }}>{icon}</span>
                  <span style={{ fontSize: 10, fontWeight: 500, color: sel ? "#B85A20" : "#5A5248" }}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Intereses del alumno */}
          <div className="mt-4 space-y-1.5">
            <label className="text-xs font-medium text-[#6B7A6C] uppercase tracking-wide">
              Intereses del alumno
              <span className="ml-1 font-normal normal-case">(opcional)</span>
            </label>
            <input
              type="text"
              value={interestsInput}
              onChange={(e) => onInterestsChange(e.target.value)}
              placeholder="Ej: dinosaurios, fútbol, Pokémon..."
              className="w-full rounded-lg border border-[#E8E0D5] bg-white px-3 py-2 text-sm text-[#2C3B2D] placeholder:text-[#B0A898] focus:outline-none focus:border-[#E8834A] transition-colors"
            />
            <p className="text-[11px] text-[#6B7A6C]">
              La IA usará estos intereses para personalizar los ejemplos de las actividades
            </p>
          </div>

          <Divider />

          {/* SECTION 2 — Perfil NEE */}
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <SectionLabel>Perfil del alumno</SectionLabel>
              <p style={{ fontSize: 13, color: "#5A5248", marginTop: -4, marginBottom: 10 }}>
                Puedes seleccionar varios perfiles
              </p>
            </div>
            {perfiles.length > 1 && (
              <span
                className="px-2 py-0.5"
                style={{ fontSize: 10, fontWeight: 600, borderRadius: 20, background: "#F0F7F2", color: "#4A7C59", border: "0.5px solid #C8DFD0" }}
              >
                {perfiles.length} seleccionados
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PERFILES_NEE.map((perfil) => (
              <button
                key={perfil.id}
                type="button"
                onClick={() => togglePerfil(perfil.id)}
                style={{
                  borderColor: perfiles.includes(perfil.id) ? perfil.color : "#E8E0D5",
                  backgroundColor: perfiles.includes(perfil.id) ? perfil.bg : "#FFFFFF",
                }}
                className={`relative w-full text-left rounded-xl border-2 p-4 transition-all ${perfiles.includes(perfil.id) ? "shadow-sm" : "hover:border-[#C8BFB5]"}`}
              >
                {/* Checkmark cuando está seleccionado */}
                {perfiles.includes(perfil.id) && (
                  <div
                    className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs"
                    style={{ backgroundColor: perfil.color }}
                  >
                    ✓
                  </div>
                )}

                {/* Badge "principal" si hay más de uno y es el primero */}
                {perfiles.length > 1 && perfiles[0] === perfil.id && (
                  <span
                    className="inline-block text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2"
                    style={{ backgroundColor: perfil.color, color: "#FFFFFF" }}
                  >
                    Principal
                  </span>
                )}

                {/* Descripción funcional — texto principal */}
                <p className="text-sm font-semibold text-[#2C3B2D] leading-snug pr-6">
                  {perfil.descripcion}
                </p>

                {/* Línea explicativa — 11px */}
                <p className="text-[11px] text-[#6B7A6C] mt-1 leading-tight">
                  {perfil.detalle}
                </p>

                {/* Sigla NEE — pequeña, abajo a la derecha */}
                <span
                  className="inline-block mt-2 text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: perfil.bg, color: perfil.color, border: `1px solid ${perfil.color}30` }}
                >
                  {perfil.sigla}
                </span>
              </button>
            ))}
          </div>

          {perfiles.length > 1 && (
            <p
              className="mt-2 px-1"
              style={{ fontSize: 10, color: "#8A8070" }}
            >
              El primer perfil seleccionado ({PERFILES_NEE.find(p => p.id === perfiles[0])?.sigla}) es el principal. Los demás son perfiles secundarios.
            </p>
          )}

          <Divider />

          {/* SECTION 3 — Nivel de apoyo */}
          <SectionLabel>Nivel de apoyo</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {GRADOS.map(({ value, label, desc }) => {
              const sel = supportDegree === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onSupportDegreeChange(value)}
                  className="flex flex-col items-center text-center"
                  style={{
                    padding: "10px 8px",
                    borderRadius: 10,
                    border: sel ? "1.5px solid #4A7C59" : "0.5px solid #E2DDD5",
                    background: sel ? "rgba(74,124,89,0.06)" : "#fff",
                    transition: "all 0.15s",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: sel ? "#4A7C59" : "#2C2620" }}>
                    {label}
                  </span>
                  <span className="mt-0.5" style={{ fontSize: 10, color: "#A09888", lineHeight: 1.3 }}>{desc}</span>
                </button>
              );
            })}
          </div>

          {/* Error */}
          {configError && (
            <div
              className="mt-4 px-4 py-3 text-sm"
              style={{ borderRadius: 10, border: "0.5px solid #f5c6c6", background: "#fef2f2", color: "#c53030" }}
            >
              {configError}
            </div>
          )}

          {/* CTA */}
          <button
            type="button"
            onClick={onGenerate}
            className="mt-6 flex w-full items-center justify-center gap-2 text-white"
            style={{
              padding: "14px 0",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 500,
              background: "#4A7C59",
              transition: "all 0.15s",
            }}
          >
            <SparklesIcon />
            Adaptar documento
          </button>
        </div>
      </div>
    </div>
  );
}
