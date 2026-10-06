import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "@/components/auth/forms";
import { Button } from "@/components/ui/button";
import { getFlags } from "@/lib/config/flags";
import { signInWithGoogle, signUp } from "../actions";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function RegisterPage() {
  const { googleAuth } = getFlags();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Crea tu cuenta</h1>
        <p className="text-sm text-muted-foreground">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
            Entrar
          </Link>
        </p>
      </div>
      <SignUpForm action={signUp} />
      {googleAuth ? (
        <form action={signInWithGoogle}>
          <Button type="submit" variant="secondary" className="w-full">
            Continuar con Google
          </Button>
        </form>
      ) : null}
    </div>
  );
}
