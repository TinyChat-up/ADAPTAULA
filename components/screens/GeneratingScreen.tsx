"use client";

import { useEffect, useState } from "react";
import type { Subject, SupportDegree } from "@/lib/adaptationRules";
import BrandLogo from "@/components/BrandLogo";

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

const STEPS = [
  "Leyendo el documento original...",
  "Identificando barreras de acceso...",
  "Diseñando la estructura pedagógica...",
  "Redactando actividades adaptadas...",
  "Revisando calidad pedagógica...",
];

interface Props {
  perfil: Perfil;
  subject: Subject;
  supportDegree: SupportDegree;
  /** Progreso real 0-100 del stream. Undefined = animación de respaldo. */
  progress?: number;
}

export default function GeneratingScreen({ perfil, subject, supportDegree, progress }: Props) {
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (progress !== undefined) {
      if (progress < 20) setStepIdx(0);
      else if (progress < 45) setStepIdx(1);
      else if (progress < 65) setStepIdx(2);
      else if (progress < 85) setStepIdx(3);
      else setStepIdx(4);
      return;
    }
    const intervals = [3500, 7000, 11000, 17000];
    const timers = intervals.map((delay, i) =>
      setTimeout(() => setStepIdx(i + 1), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [progress]);

  const chipStyle = (type: "subject" | "degree" | "default") => {
    const base = { fontSize: 11, borderRadius: 20, padding: "4px 11px", fontWeight: 500 as const };
    if (type === "subject")
      return { ...base, border: "0.5px solid #F0C4A0", background: "rgba(232,131,74,0.06)", color: "#B85A20" };
    if (type === "degree")
      return { ...base, border: "0.5px solid #B8D4B8", background: "rgba(74,124,89,0.06)", color: "#4A7C59" };
    return { ...base, border: "0.5px solid #E2DDD5", background: "#fff", color: "#5A5248" };
  };

  const skeletonItems = [
    { w: "60%",  h: 13, r: 6, delay: 0 },
    { w: "90%",  h: 13, r: 6, delay: 0.15 },
    { w: "75%",  h: 13, r: 6, delay: 0.3 },
    { w: "100%", h: 52, r: 8, delay: 0.45 },
    { w: "50%",  h: 13, r: 6, delay: 0.6 },
    { w: "85%",  h: 13, r: 6, delay: 0.75 },
    { w: "100%", h: 52, r: 8, delay: 0.9 },
    { w: "40%",  h: 13, r: 6, delay: 1.05 },
  ];

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "#FEFCF9" }}>
      {/* ── Nav top ── */}
      <nav
        className="flex items-center justify-center px-5 py-3"
        style={{ borderBottom: "0.5px solid #EDE8E0" }}
      >
        <BrandLogo compact />
      </nav>

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-[440px]">
          {/* Context chips */}
          <div className="mb-6 flex flex-wrap justify-center gap-2">
            <span style={chipStyle("subject")}>{SUBJECT_LABELS[subject]}</span>
            <span style={chipStyle("degree")}>{DEGREE_LABELS[supportDegree]}</span>
            <span style={chipStyle("default")}>{PERFIL_LABELS[perfil]}</span>
          </div>

          {/* Ink splash loader */}
          <div className="mb-2 flex justify-center">
            <div style={{ position: "relative", width: 100, height: 100, filter: "blur(4px)" }}>
              <div style={{
                position: "absolute", width: 56, height: 56, background: "#E8834A",
                top: 12, left: 6, opacity: 0.7, borderRadius: "50%",
                animation: "inkA 3s ease-in-out infinite",
              }} />
              <div style={{
                position: "absolute", width: 50, height: 50, background: "#4A7C59",
                top: 24, left: 30, opacity: 0.7, borderRadius: "50%",
                animation: "inkB 3.2s ease-in-out infinite",
              }} />
              <div style={{
                position: "absolute", width: 40, height: 40, background: "#7CB9D6",
                top: 8, left: 36, opacity: 0.6, borderRadius: "50%",
                animation: "inkA 2.8s ease-in-out infinite 0.5s",
              }} />
            </div>
          </div>

          {/* Step text */}
          <p className="mt-2 text-center" style={{ fontSize: 12, color: "#8A8070" }}>
            {STEPS[Math.min(stepIdx, STEPS.length - 1)]}
          </p>

          {/* Skeleton blocks */}
          <div className="mt-6 space-y-2.5">
            {skeletonItems.map(({ w, h, r, delay }, i) => (
              <div
                key={i}
                style={{
                  width: w,
                  height: h,
                  borderRadius: r,
                  background: "linear-gradient(90deg, #F0ECE6 25%, #E8E3DC 50%, #F0ECE6 75%)",
                  backgroundSize: "800px 100%",
                  animation: `shimmer 1.8s infinite, fadeUp 0.5s ease-out ${delay}s both`,
                }}
              />
            ))}
          </div>

          {/* Hint */}
          <p className="mt-6 text-center" style={{ fontSize: 11, color: "#C0B8B0" }}>
            Esto puede tardar entre 15 y 40 segundos
          </p>
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0%   { background-position: -400px 0; }
          100% { background-position:  400px 0; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes inkA {
          0%,100% { transform: translate(0,0) scale(1); border-radius: 50% 45% 55% 40%; }
          50%      { transform: translate(8px,-6px) scale(1.2); border-radius: 40% 55% 45% 50%; }
        }
        @keyframes inkB {
          0%,100% { transform: translate(0,0) scale(1); border-radius: 45% 50% 40% 55%; }
          50%      { transform: translate(-10px,5px) scale(1.15); border-radius: 55% 40% 50% 45%; }
        }
      `}</style>
    </div>
  );
}
