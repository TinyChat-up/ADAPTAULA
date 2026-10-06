"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceCards, type Choice } from "@/components/ui/choice-cards";
import { Alert } from "@/components/ui/feedback";
import type { OnboardingInput } from "@/lib/schemas/onboarding";

type Stage = OnboardingInput["stage"];
type Start = OnboardingInput["start"];

const STAGES: Choice<Stage>[] = [
  { value: "primaria", label: "Primaria" },
  { value: "eso", label: "ESO" },
  { value: "bachillerato", label: "Bachillerato" },
  { value: "varias", label: "Varias etapas" },
];

const STARTS: Choice<Start>[] = [
  { value: "adaptar", label: "Adaptar una ficha", description: "Ve directo a subir un material." },
  { value: "perfil", label: "Crear un perfil", description: "Define primero las necesidades de un alumno o alumna." },
  { value: "explorar", label: "Explorar Adaptaula", description: "Echa un vistazo antes de empezar." },
];

export function OnboardingWizard({ action }: { action: (input: unknown) => Promise<{ error: string }> }) {
  const [step, setStep] = useState(1);
  const [stage, setStage] = useState<Stage | null>(null);
  const [start, setStart] = useState<Start | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canContinue = (step === 1 && stage !== null) || (step === 2 && start !== null) || step === 3;

  function finish() {
    setError(null);
    startTransition(async () => {
      const result = await action({ stage, start });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Paso {step} de 3</p>
        <div
          role="progressbar"
          aria-label="Progreso del primer paso"
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={step}
          aria-valuetext={`Paso ${step} de 3`}
          className="h-1.5 overflow-hidden rounded-full bg-border"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${(step / 3) * 100}%` }} />
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {step === 1 ? <ChoiceCards name="stage" legend="¿Qué enseñas?" options={STAGES} value={stage} onChange={setStage} columns={2} /> : null}
      {step === 2 ? <ChoiceCards name="start" legend="¿Cómo quieres empezar?" options={STARTS} value={start} onChange={setStart} /> : null}
      {step === 3 ? (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Privacidad</h2>
          <p className="text-lg">
            Puedes utilizar iniciales o alias para identificar al alumnado. Evita introducir información personal innecesaria.
          </p>
          <p className="text-muted-foreground">
            No te pediremos nombres completos, fechas de nacimiento, DNI, fotografías ni informes.
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        {step > 1 ? (
          <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={pending}>
            Atrás
          </Button>
        ) : (
          <span />
        )}
        {step < 3 ? (
          <Button onClick={() => setStep(step + 1)} disabled={!canContinue}>
            Siguiente
          </Button>
        ) : (
          <Button onClick={finish} disabled={pending || !stage || !start}>
            {pending ? "Un momento…" : "Entrar en Adaptaula"}
          </Button>
        )}
      </div>
    </div>
  );
}
