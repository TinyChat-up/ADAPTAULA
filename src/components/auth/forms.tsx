"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/fields";
import { Alert } from "@/components/ui/feedback";
import type { AuthFormState } from "@/lib/schemas/auth";

type Action = (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
const initial: AuthFormState = { status: "idle" };

function useAuthAction(action: Action) {
  return useActionState(action, initial);
}

function FormMessage({ state }: { state: AuthFormState }) {
  if (state.status === "idle" || !state.message) return null;
  return <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert>;
}

function Submit({ pending, children }: { pending: boolean; children: string }) {
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Un momento…" : children}
    </Button>
  );
}

export function SignInForm({ action, next }: { action: Action; next: string }) {
  const [state, formAction, pending] = useAuthAction(action);
  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required error={state.fieldErrors?.email} />
      <TextField
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password}
      />
      <Submit pending={pending}>Entrar</Submit>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="font-medium text-primary underline-offset-2 hover:underline">
          Olvidé mi contraseña
        </Link>
      </p>
    </form>
  );
}

export function MagicLinkForm({ action, next }: { action: Action; next: string }) {
  const [state, formAction, pending] = useAuthAction(action);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required error={state.fieldErrors?.email} />
      <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
        {pending ? "Enviando…" : "Enviarme un enlace"}
      </Button>
    </form>
  );
}

export function SignUpForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useAuthAction(action);
  if (state.status === "success") return <Alert tone="success" title="Revisa tu email">{state.message}</Alert>;
  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <TextField label="Nombre" name="full_name" autoComplete="name" optional error={state.fieldErrors?.full_name} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required error={state.fieldErrors?.email} />
      <TextField
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="Mínimo 8 caracteres."
        error={state.fieldErrors?.password}
      />
      <Submit pending={pending}>Crear cuenta</Submit>
      <p className="text-center text-xs text-muted-foreground">
        Al crear tu cuenta aceptas los{" "}
        <Link href="/terminos" className="underline underline-offset-2">
          términos
        </Link>{" "}
        y la{" "}
        <Link href="/privacidad" className="underline underline-offset-2">
          política de privacidad
        </Link>
        .
      </p>
    </form>
  );
}

export function ForgotPasswordForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useAuthAction(action);
  if (state.status === "success") return <Alert tone="success" title="Revisa tu email">{state.message}</Alert>;
  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required error={state.fieldErrors?.email} />
      <Submit pending={pending}>Enviar enlace</Submit>
    </form>
  );
}

export function ResetPasswordForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useAuthAction(action);
  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <TextField
        label="Contraseña nueva"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="Mínimo 8 caracteres."
        error={state.fieldErrors?.password}
      />
      <TextField
        label="Repite la contraseña"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirm}
      />
      <Submit pending={pending}>Guardar contraseña</Submit>
    </form>
  );
}
