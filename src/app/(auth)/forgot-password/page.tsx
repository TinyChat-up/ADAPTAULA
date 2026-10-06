import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forms";
import { requestPasswordReset } from "../actions";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Recuperar contraseña</h1>
        <p className="text-sm text-muted-foreground">Te enviaremos un enlace para elegir una contraseña nueva.</p>
      </div>
      <ForgotPasswordForm action={requestPasswordReset} />
      <p className="text-center text-sm">
        <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
          Volver a entrar
        </Link>
      </p>
    </div>
  );
}
