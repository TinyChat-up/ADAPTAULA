"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/fields";
import type { AccountNameState } from "@/lib/schemas/account";

export function AccountNameForm({ name, action }: {
  name: string;
  action: (previous: AccountNameState, form: FormData) => Promise<AccountNameState>;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [edited, setEdited] = useState(false);
  return (
    <form action={formAction} className="space-y-3" onSubmit={() => setEdited(false)}>
      <TextField label="Nombre visible" name="full_name" defaultValue={name} autoComplete="name" maxLength={120}
        required error={state.error} onChange={() => setEdited(true)} hint="Tu nombre de docente. Se muestra en tu cuenta y en el saludo de inicio." />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar nombre"}</Button>
        <p role="status" className="text-sm text-muted-foreground">{edited ? "Cambios sin guardar" : state.message}</p>
      </div>
    </form>
  );
}
