import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { MagicLinkForm, SignInForm } from "@/components/auth/forms";
import { safeNextPath } from "@/lib/auth/paths";
import { getFlags } from "@/lib/config/flags";
import { signIn, signInWithGoogle, signInWithMagicLink } from "../actions";

export const metadata: Metadata = { title: "Entrar" };

const ERRORS: Record<string, string> = {
  enlace: "El enlace no es válido o ha caducado. Pide uno nuevo.",
  google: "No hemos podido entrar con Google. Inténtalo de nuevo.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined);
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const { googleAuth } = getFlags();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Entrar en Adaptaula</h1>
        <p className="text-sm text-muted-foreground">
          ¿Aún no tienes cuenta?{" "}
          <Link href="/registro" className="font-medium text-primary underline-offset-2 hover:underline">
            Crear cuenta
          </Link>
        </p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <SignInForm action={signIn} next={next} />
      {googleAuth ? (
        <form action={signInWithGoogle}>
          <Button type="submit" variant="secondary" className="w-full">
            Entrar con Google
          </Button>
        </form>
      ) : null}
      <details className="group border-t border-border pt-4">
        <summary className="cursor-pointer text-sm font-medium text-primary">Prefiero entrar con un enlace por email</summary>
        <div className="mt-4">
          <MagicLinkForm action={signInWithMagicLink} next={next} />
        </div>
      </details>
    </div>
  );
}
