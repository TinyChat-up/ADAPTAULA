"use client";

import { useEffect, useState } from "react";

type GenerationCompanionProps = {
  active: boolean;
};

const STEPS = [
  { label: "Leyendo el documento original", duration: 1800 },
  { label: "Identificando barreras de acceso", duration: 2200 },
  { label: "Diseñando la estructura de la ficha", duration: 2600 },
  { label: "Redactando actividades adaptadas", duration: 3200 },
  { label: "Revisando calidad pedagógica", duration: 0 },
];

export default function GenerationCompanion({ active }: GenerationCompanionProps) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setStepIndex(0);
      return;
    }

    let currentStep = 0;
    setStepIndex(0);

    const advance = () => {
      currentStep += 1;
      if (currentStep < STEPS.length) {
        setStepIndex(currentStep);
        const nextDuration = STEPS[currentStep]?.duration;
        if (nextDuration) {
          setTimeout(advance, nextDuration);
        }
      }
    };

    const first = STEPS[0]?.duration;
    if (first) {
      const t = setTimeout(advance, first);
      return () => clearTimeout(t);
    }
  }, [active]);

  return (
    <div
      className={`rounded-[32px] border border-emerald-100/90 bg-gradient-to-br from-white via-emerald-50/70 to-cyan-50/60 p-7 shadow-[0_26px_55px_rgba(6,95,70,0.12)] transition-all duration-500 ${
        active ? "translate-y-0 opacity-100" : "translate-y-1 opacity-80"
      }`}
    >
      {/* Avatar */}
      <div className="flex justify-center">
        <div className="relative h-28 w-28 shrink-0">
          <div className={`absolute inset-0 rounded-[34px] bg-emerald-100/75 ${active ? "animate-pulse" : ""}`} />
          <div className="absolute inset-3 rounded-[28px] bg-white shadow-[inset_0_1px_8px_rgba(15,23,42,0.08)]" />
          <div className="absolute left-5 top-4 h-4 w-4 rounded-full bg-cyan-300/80 animate-[float_2.4s_ease-in-out_infinite]" />
          <div className="absolute right-5 top-7 h-3.5 w-3.5 rounded-full bg-amber-300/90 animate-[float_2.2s_ease-in-out_infinite_0.2s]" />
          <div className="absolute left-1/2 top-10 h-4 w-4 -translate-x-[20px] rounded-full bg-emerald-700 animate-[blink_2.5s_infinite]" />
          <div className="absolute left-1/2 top-10 h-4 w-4 translate-x-[6px] rounded-full bg-emerald-700 animate-[blink_2.5s_infinite_0.25s]" />
          <div className="absolute left-1/2 top-[66px] h-3 w-14 -translate-x-1/2 rounded-full bg-emerald-200" />
          <div className="absolute left-1/2 top-[76px] h-2 w-10 -translate-x-1/2 rounded-full bg-emerald-300/80" />
          <div className={`absolute -right-2 bottom-4 h-5 w-5 rounded-full bg-emerald-300/60 ${active ? "animate-[orbit_3s_linear_infinite]" : ""}`} />
        </div>
      </div>

      {/* Steps */}
      <div className="mt-6 space-y-2.5">
        {STEPS.map((step, i) => {
          const done = i < stepIndex;
          const current = i === stepIndex && active;
          const pending = i > stepIndex;

          return (
            <div
              key={step.label}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-500 ${
                current
                  ? "bg-emerald-50 shadow-[0_0_0_1px_#a7f3d0]"
                  : done
                  ? "opacity-60"
                  : pending
                  ? "opacity-30"
                  : ""
              }`}
            >
              {/* Icon */}
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {done ? (
                  <svg className="h-4 w-4 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                ) : current ? (
                  <span className="h-2.5 w-2.5 animate-ping rounded-full bg-emerald-500" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-slate-300" />
                )}
              </span>
              <span
                className={`text-sm ${
                  current
                    ? "font-semibold text-emerald-800"
                    : done
                    ? "text-slate-500 line-through"
                    : "text-slate-400"
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      {active ? (
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-emerald-100">
          <div className="h-full w-1/3 animate-[progress_1.7s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" />
        </div>
      ) : null}

      <style jsx global>{`
        @keyframes progress {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(320%); }
        }
        @keyframes blink {
          0%, 46%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(0.2); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes orbit {
          0%   { transform: translateX(0) translateY(0) scale(1); }
          25%  { transform: translateX(4px) translateY(-3px) scale(1.05); }
          50%  { transform: translateX(0) translateY(-6px) scale(1); }
          75%  { transform: translateX(-4px) translateY(-3px) scale(0.95); }
          100% { transform: translateX(0) translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
