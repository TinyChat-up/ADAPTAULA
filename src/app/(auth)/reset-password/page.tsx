import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/feedback";
import { ResetPasswordForm } from "@/components/auth/forms";
import { getUser } from "@/lib/auth/session";
import { resetPassword } from "../actions";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default async function ResetPasswordPage() {
  const user = await getUser();
  if (!user) {
    return (
      <div className="space-y-4">
        <Alert tone="warning" title="El enlace ha caducado">
          Solicita uno nuevo para poder elegir una contraseña.
        </Alert>
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="font-medium text-primary underline-offset-2 hover:underline">
            Pedir un enlace nuevo
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Elige una contraseña nueva</h1>
      <ResetPasswordForm action={resetPassword} />
    </div>
  );
}
