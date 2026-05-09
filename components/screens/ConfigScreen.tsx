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

type PerfilConfig = {
  value: LearningProfile;
  label: string;
  fullName: string;
  desc: string;
  color: string;
  bg: string;
};

const PERFILES: PerfilConfig[] = [
  {
    value: "tea",
    label: "TEA",
    fullName: "Espectro Autista",
    desc: "Estructura visual, literalidad, predictibilidad",
    color: "#4A7C59",
    bg: "#F0F7F2",
  },
  {
    value: "tdah",
    label: "TDAH",
    fullName: "Déficit de Atención",
    desc: "Chunking, checkpoints de completado, variedad",
    color: "#C07800",
    bg: "#FFFBEE",
  },
  {
    value: "dislexia",
    label: "Dislexia",
    fullName: "Dificultad lectora",
    desc: "Tipografía adaptada, fondo crema, espaciado",
    color: "#C04A1A",
    bg: "#FFF5F0",
  },
  {
    value: "di",
    label: "DI",
    fullName: "Discapacidad Intelectual",
    desc: "Vocabulario básico, máximo andamiaje visual",
    color: "#2B6CB0",
    bg: "#EBF4FF",
  },
  {
    value: "tel",
    label: "TEL",
    fullName: "Trastorno del Lenguaje",
    desc: "Frases simples, apoyos fonológicos, ejemplos",
    color: "#6B3FA0",
    bg: "#F5EEFF",
  },
  {
    value: "retraso",
    label: "Retraso",
    fullName: "Retraso Madurativo",
    desc: "Desfase temporal, andamiaje progresivo",
    color: "#A0416B",
    bg: "#FFF0F6",
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
  interestsInput: _interestsInput,
  educationalLevel: _educationalLevel,
  configError,
  showSecondaryWarning,
  onPerfilesChange,
  onSubjectChange,
  onSupportDegreeChange,
  onInterestsChange: _onInterestsChange,
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

  const primaryPerfil = perfiles[0];

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

          <div className="grid grid-cols-2 gap-2">
            {PERFILES.map(({ value, label, fullName, desc, color, bg }) => {
              const sel = perfiles.includes(value);
              const isPrimary = value === primaryPerfil;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => togglePerfil(value)}
                  className="text-left relative"
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: sel ? `1.5px solid ${color}` : "0.5px solid #E2DDD5",
                    background: sel ? bg : "#fff",
                    transition: "all 0.15s",
                  }}
                >
                  {/* Selected indicator */}
                  {sel && (
                    <span
                      className="absolute top-2 right-2 flex items-center justify-center"
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: color,
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}

                  <div className="flex items-center gap-2 mb-1 pr-5">
                    <span
                      className="inline-flex items-center justify-center shrink-0"
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 7px",
                        borderRadius: 20,
                        background: sel ? color : "#EDE8E0",
                        color: sel ? "#fff" : "#5A5248",
                        letterSpacing: "0.03em",
                      }}
                    >
                      {label}
                    </span>
                    {sel && isPrimary && perfiles.length > 1 && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          color: color,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        principal
                      </span>
                    )}
                  </div>

                  <p style={{ fontSize: 12, fontWeight: 500, color: sel ? "#2C2620" : "#3A3028", marginBottom: 2 }}>
                    {fullName}
                  </p>
                  <p style={{ fontSize: 10, color: sel ? "#5A5248" : "#A09888", lineHeight: 1.4 }}>
                    {desc}
                  </p>
                </button>
              );
            })}
          </div>

          {perfiles.length > 1 && (
            <p
              className="mt-2 px-1"
              style={{ fontSize: 10, color: "#8A8070" }}
            >
              El primer perfil seleccionado ({PERFILES.find(p => p.value === primaryPerfil)?.label}) es el principal. Los demás son perfiles secundarios.
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
