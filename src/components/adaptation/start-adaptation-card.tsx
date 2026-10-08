"use client";

import { ListChecks, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { SelectField } from "@/components/ui/fields";
import { Alert } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import type { PublicResult } from "@/lib/adaptation/orchestration/public";
import { CREATION_COPY, actionErrorCopy } from "@/lib/adaptation/presentation/copy";

export interface ProfileOption {
  id: string;
  name: string;
}

export type CreationModeChoice = "automatic" | "review";

/**
 * The one entry point that creates an adaptation (reached from the material, from a profile and from the home screen): choose the
 * functional profile, then how to prepare the sheet. «Hacer magia» goes straight to the final sheet; «Revisar antes de crear»
 * stops to show how the material will be adapted. Either click creates AND starts the adaptation. The workspace, the plan and the
 * limits are resolved on the server; one key per mode makes a double click create one adaptation.
 */
export function StartAdaptationCard({
  profiles,
  initialProfileId,
  canWrite,
  newProfileHref,
  create,
}: {
  profiles: ProfileOption[];
  initialProfileId?: string | undefined;
  canWrite: boolean;
  newProfileHref: string;
  create: (input: { learnerProfileId: string; requestKey: string; mode: CreationModeChoice }) => Promise<PublicResult<{ adaptationId: string }>>;
}) {
  const router = useRouter();
  const uid = useId();
  const [profileId, setProfileId] = useState(initialProfileId ?? (profiles.length === 1 ? profiles[0]!.id : ""));
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [pending, setPending] = useState<CreationModeChoice | null>(null);
  const lock = useRef(false);
  const [requestKey] = useState(() => crypto.randomUUID());

  async function start(mode: CreationModeChoice) {
    if (lock.current) return;
    if (!profileId) {
      setFieldError("Elige un perfil para adaptar el material.");
      document.getElementById(`${uid}-profile`)?.focus();
      return;
    }
    lock.current = true;
    setPending(mode);
    setError(null);
    setFieldError(undefined);
    try {
      const result = await create({ learnerProfileId: profileId, requestKey: `${requestKey}:${mode}`, mode });
      if (result.ok) {
        router.push(`/app/adaptaciones/${result.data.adaptationId}`);
        return;
      }
      setError(actionErrorCopy(result.code, result.message));
    } catch {
      setError("No hemos podido crear la adaptación. Comprueba la conexión e inténtalo de nuevo.");
    }
    lock.current = false;
    setPending(null);
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold">Adaptar este material</h2>
      {!canWrite ? (
        <p className="text-sm text-muted-foreground">Tienes acceso de solo lectura en este espacio de trabajo: puedes ver las adaptaciones, pero no crear nuevas.</p>
      ) : profiles.length === 0 ? (
        <>
          <p className="text-sm text-muted-foreground">Para adaptar el material necesitas un perfil con las necesidades que quieres tener en cuenta. Al crearlo volverás aquí.</p>
          <LinkButton href={newProfileHref}>Crear un perfil</LinkButton>
        </>
      ) : (
        <div className="space-y-5">
          <SelectField id={`${uid}-profile`} label="Perfil" hint="Solo se tienen en cuenta sus necesidades, nunca el nombre." value={profileId} error={fieldError} onChange={(e) => setProfileId(e.target.value)} disabled={pending !== null}>
            <option value="">Elige un perfil</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>

          <section aria-labelledby={`${uid}-how`} className="space-y-3">
            <h3 id={`${uid}-how`} className="text-base font-semibold">
              {CREATION_COPY.question}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-card border border-primary/40 bg-primary/5 p-4">
                <Button size="lg" onClick={() => void start("automatic")} disabled={pending !== null} aria-describedby={`${uid}-magic`}>
                  {pending === "automatic" ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : <Sparkles aria-hidden className="size-4" />}
                  {CREATION_COPY.automatic.label}
                </Button>
                <p id={`${uid}-magic`} className="text-sm text-foreground/90">
                  <span className="font-medium">Recomendado. </span>
                  {CREATION_COPY.automatic.body}
                </p>
              </div>
              <div className="flex flex-col gap-2 rounded-card border border-border p-4">
                <Button size="lg" variant="secondary" onClick={() => void start("review")} disabled={pending !== null} aria-describedby={`${uid}-review`}>
                  {pending === "review" ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : <ListChecks aria-hidden className="size-4" />}
                  {CREATION_COPY.review.label}
                </Button>
                <p id={`${uid}-review`} className="text-sm text-muted-foreground">
                  {CREATION_COPY.review.body}
                </p>
              </div>
            </div>
          </section>

          {error ? <Alert tone="warning" title={error} /> : null}
          <p className="text-sm">
            ¿Es para otra persona?{" "}
            <Link href={newProfileHref} className="font-medium text-primary underline underline-offset-2">
              Crear un perfil nuevo
            </Link>
          </p>
        </div>
      )}
    </Card>
  );
}
