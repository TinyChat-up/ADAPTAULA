"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { SelectField } from "@/components/ui/fields";
import { Alert } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import type { PublicResult } from "@/lib/adaptation/orchestration/public";
import { actionErrorCopy } from "@/lib/adaptation/presentation/copy";

export interface ProfileOption {
  id: string;
  name: string;
}

/**
 * The one entry point that creates an adaptation (reached from the material, from a profile and from the home screen): choose the
 * functional profile and create it, then go to its page, where nothing starts until the teacher says so. The workspace, the plan
 * and the limits are resolved on the server; the key makes a double click create one adaptation.
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
  create: (input: { learnerProfileId: string | null; requestKey: string }) => Promise<PublicResult<{ adaptationId: string }>>;
}) {
  const router = useRouter();
  const [profileId, setProfileId] = useState(initialProfileId ?? (profiles.length === 1 ? profiles[0]!.id : ""));
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [requestKey] = useState(() => crypto.randomUUID());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    if (!profileId) {
      setFieldError("Elige un perfil para adaptar el material.");
      return;
    }
    lock.current = true;
    setPending(true);
    setError(null);
    setFieldError(undefined);
    try {
      const result = await create({ learnerProfileId: profileId, requestKey });
      if (result.ok) {
        router.push(`/app/adaptaciones/${result.data.adaptationId}`);
        return;
      }
      setError(actionErrorCopy(result.code, result.message));
    } catch {
      setError("No hemos podido crear la adaptación. Comprueba la conexión e inténtalo de nuevo.");
    }
    lock.current = false;
    setPending(false);
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
        <form onSubmit={submit} noValidate className="space-y-4">
          <SelectField label="Perfil" hint="Solo se tienen en cuenta sus necesidades, nunca el nombre. Después podrás revisar la propuesta antes de crear la ficha." value={profileId} error={fieldError} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">Elige un perfil</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          {error ? <Alert tone="warning" title={error} /> : null}
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : null}
            Adaptar material
          </Button>
          <p className="text-sm">
            ¿Es para otra persona?{" "}
            <Link href={newProfileHref} className="font-medium text-primary underline underline-offset-2">
              Crear un perfil nuevo
            </Link>
          </p>
        </form>
      )}
    </Card>
  );
}
