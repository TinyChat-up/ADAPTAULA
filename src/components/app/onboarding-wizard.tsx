"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceCards, type Choice } from "@/components/ui/choice-cards";
import { Alert } from "@/components/ui/feedback";
import type { OnboardingInput } from "@/lib/schemas/onboarding";

type Stage = OnboardingInput["stage"];
type Start = OnboardingInput["start"];

const STAGES: Choice<Stage>[] = [
  { value: "primaria", label: "Primaria" }, { value: "eso", label: "ESO" },
  { value: "bachillerato", label: "Bachillerato" }, { value: "varias", label: "Varias etapas" },
];
const STARTS: Choice<Start>[] = [
  { value: "adaptar", label: "Subir mi primera ficha", description: "Ir al espacio de trabajo documental." },
  { value: "perfil", label: "Crear primero un perfil", description: "Definir los apoyos funcionales con un alias." },
  { value: "explorar", label: "Explorar mi mesa de trabajo", description: "Conocer Adaptaula antes de subir un material." },
];

export function OnboardingWizard({ action, plan }: { action: (input: unknown) => Promise<{ error: string }>; plan: { name: string; adaptations: number; analyses: number; profiles: number } }) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [start, setStart] = useState<Start>("adaptar");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function finish() {
    if (!stage) return;
    setError(null);
    startTransition(async () => {
      const result = await action({ stage, start });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-7">
      <div className="space-y-2"><p className="eyebrow text-primary">Primeros pasos</p><h1 className="font-display text-3xl tracking-tight sm:text-4xl">Tu primera ficha empieza aquí.</h1><p className="text-muted-foreground">Elige la etapa en la que trabajas. Podrás cambiarla después.</p></div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ChoiceCards name="stage" legend="¿Qué enseñas?" options={STAGES} value={stage} onChange={setStage} columns={2} />
      <div className="border-y border-border py-5 text-sm"><p className="font-medium">Un perfil funcional describe apoyos, no diagnósticos.</p><p className="mt-1 text-muted-foreground">Después de subir la ficha, podrás elegir apoyos de lectura, lenguaje, organización o matemáticas. Identifica al alumnado mediante un alias o iniciales.</p></div>
      <div className="space-y-3"><p className="text-sm font-medium">Tu plan {plan.name} incluye {plan.adaptations} {plan.adaptations === 1 ? "adaptación" : "adaptaciones"} y {plan.analyses} análisis por periodo; puedes guardar {plan.profiles} perfiles.</p><p className="text-sm text-muted-foreground">No necesitas crear un perfil ahora. Evita introducir nombres completos, datos médicos o informes del alumnado.</p></div>
      <details className="group border-t border-border pt-4"><summary className="cursor-pointer font-medium text-primary">Prefiero empezar de otra forma</summary><div className="mt-4"><ChoiceCards name="start" legend="Elige cómo continuar" options={STARTS} value={start} onChange={setStart} /></div></details>
      <Button onClick={finish} disabled={pending || !stage} size="lg" className="w-full">{pending ? "Preparando tu espacio…" : start === "adaptar" ? "Subir mi primera ficha" : "Entrar en Adaptaula"}</Button>
    </div>
  );
}
