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
import { actionErrorCopy, statusLabel } from "@/lib/adaptation/presentation/copy";
import { formatDateTime } from "@/lib/format/date";

export interface ProfileOption {
  id: string;
  name: string;
}

/**
 * Entry point from an analyzed material: choose the functional profile and create the adaptation, then go to its page.
 * The workspace, the plan and the limits are resolved on the server; the key makes a double click create one adaptation.
 */
export function StartAdaptationCard({
  profiles,
  recent,
  create,
}: {
  profiles: ProfileOption[];
  recent: Array<{ id: string; status: string; createdAt: string }>;
  create: (input: { learnerProfileId: string | null; requestKey: string }) => Promise<PublicResult<{ adaptationId: string }>>;
}) {
  const router = useRouter();
  const [profileId, setProfileId] = useState(profiles.length === 1 ? profiles[0]!.id : "");
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
      {profiles.length === 0 ? (
        <>
          <p className="text-sm text-muted-foreground">Para adaptar el material necesitas un perfil con las necesidades que quieres tener en cuenta.</p>
          <LinkButton href="/app/alumnos/nuevo" variant="secondary">
            Crear un perfil
          </LinkButton>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <SelectField label="Perfil" hint="Solo se tienen en cuenta sus necesidades, nunca el nombre." value={profileId} error={fieldError} onChange={(e) => setProfileId(e.target.value)}>
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
        </form>
      )}
      {recent.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Adaptaciones de este material</h3>
          <ul className="space-y-1 text-sm">
            {recent.map((item) => (
              <li key={item.id}>
                <Link href={`/app/adaptaciones/${item.id}`} className="inline-flex min-h-11 items-center gap-2 font-medium text-primary underline underline-offset-2">
                  {formatDateTime(item.createdAt)}
                </Link>{" "}
                <span className="text-muted-foreground">· {statusLabel(item.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
