"use client";

import { useEffect, useState } from "react";
import BrandLogo from "@/components/BrandLogo";
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
  /** Progreso real 0-100 del stream. Undefined = animación fake de respaldo. */
  progress?: number;
}

export default function GeneratingScreen({ perfil, subject, supportDegree, progress }: Props) {
  const [stepIdx, setStepIdx] = useState(0);

  // Los pasos cambian por tiempo estimado cuando no tenemos progreso real,
  // y se avanzan proporcionalmente al progreso real cuando lo tenemos.
  useEffect(() => {
    if (progress !== undefined) {
      // Con progreso real: calcular paso por rango
      if (progress < 20) setStepIdx(0);
      else if (progress < 45) setStepIdx(1);
      else if (progress < 65) setStepIdx(2);
      else if (progress < 85) setStepIdx(3);
      else setStepIdx(4);
      return;
    }
    // Sin progreso real: avanzar pasos por tiempo
    const intervals = [3500, 7000, 11000, 17000];
    const timers = intervals.map((delay, i) =>
      setTimeout(() => setStepIdx(i + 1), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [progress]);

  return (
    <div className="aa-screen flex flex-col items-center justify-center px-4 py-14">
      {/* Logo */}
      <div className="mb-10">
        <BrandLogo />
      </div>

      <div className="w-full max-w-[520px]">
        {/* Context chips */}
        <div className="mb-6 flex flex-wrap justify-center gap-2">
          {[PERFIL_LABELS[perfil], SUBJECT_LABELS[subject], DEGREE_LABELS[supportDegree]].map((chip) => (
            <span
              key={chip}
              className="rounded-full border px-3 py-1 text-xs font-medium"
              style={{ borderColor: "#c8dcc8", background: "rgba(123,175,127,0.10)", color: "var(--aa-green-dark)" }}
            >
              {chip}
            </span>
          ))}
        </div>

        {/* Progress bar — real cuando hay progreso, animada como fallback */}
        <div className="mb-3 overflow-hidden rounded-full" style={{ background: "#dde8dd", height: 6 }}>
          {progress !== undefined ? (
            <div
              style={{
                height: 6,
                width: `${progress}%`,
                background: "var(--aa-green)",
                borderRadius: 9999,
                transition: "width 0.4s ease-out",
              }}
            />
          ) : (
            <div className="aa-progress-bar" />
          )}
        </div>
        <p className="mb-8 text-center text-sm font-medium" style={{ color: "var(--aa-text-muted)" }}>
          {STEPS[Math.min(stepIdx, STEPS.length - 1)]}
        </p>

        {/* Skeleton blocks */}
        <div className="space-y-3">
          {[{ w: "100%", h: 14, delay: "0s" }, { w: "85%", h: 14, delay: "0.4s" }, { w: "92%", h: 14, delay: "0.8s" }, { w: "100%", h: 56, delay: "1.2s" }, { w: "78%", h: 14, delay: "1.6s" }, { w: "100%", h: 56, delay: "2s" }, { w: "65%", h: 14, delay: "2.4s" }].map(({ w, h, delay }, i) => (
            <div
              key={i}
              className="aa-skeleton"
              style={{
                width: w,
                height: h,
                opacity: 0,
                animation: `aa-block-in 0.4s ease-out ${delay} forwards`,
              }}
            />
          ))}
        </div>

        <p className="mt-8 text-center text-xs" style={{ color: "#9aaa9b" }}>
          Esto puede tardar entre 15 y 40 segundos
        </p>
      </div>
    </div>
  );
}
