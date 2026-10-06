"use server";

import { redirect } from "next/navigation";
import { getFlags } from "@/lib/config/flags";
import { publicEnv } from "@/lib/config/env.public";
import { safeNextPath } from "@/lib/auth/paths";
import { getSupabase, getUser } from "@/lib/auth/session";
import {
  EmailOnlySchema,
  ResetPasswordSchema,
  SignInSchema,
  SignUpSchema,
  fieldErrorsFrom,
  type AuthFormState,
} from "@/lib/schemas/auth";

const GENERIC_ERROR = "No hemos podido completar la acción. Inténtalo de nuevo en unos minutos.";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function callbackUrl(next: string): string {
  return `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`;
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = SignUpSchema.safeParse({
    full_name: text(formData, "full_name") || undefined,
    email: text(formData, "email"),
    password: text(formData, "password"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: callbackUrl("/app"), data: { full_name: parsed.data.full_name ?? "" } },
  });

  if (error) {
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: "Elige una contraseña más segura (mezcla letras y números)." } };
    }
    if (error.code === "over_email_send_rate_limit") {
      return { status: "error", message: "Se han enviado demasiados emails. Espera unos minutos e inténtalo de nuevo." };
    }
    return { status: "error", message: GENERIC_ERROR };
  }

  if (data.session) redirect("/app");
  // Same message whether or not the email already existed: no account enumeration.
  return {
    status: "success",
    message: "Te hemos enviado un email para confirmar tu cuenta. Ábrelo y sigue el enlace para entrar.",
  };
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = SignInSchema.safeParse({ email: text(formData, "email"), password: text(formData, "password") });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { status: "error", message: "Confirma tu email antes de entrar. Revisa tu bandeja de entrada." };
    }
    return { status: "error", message: "El email o la contraseña no son correctos." };
  }
  redirect(safeNextPath(text(formData, "next")));
}

export async function signInWithMagicLink(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = EmailOnlySchema.safeParse({ email: text(formData, "email") });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await getSupabase();
  await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: false, emailRedirectTo: callbackUrl(safeNextPath(text(formData, "next"))) },
  });
  return { status: "success", message: "Si hay una cuenta con ese email, recibirás un enlace para entrar." };
}

export async function signInWithGoogle(): Promise<void> {
  if (!getFlags().googleAuth) redirect("/login");
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl("/app") },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = EmailOnlySchema.safeParse({ email: text(formData, "email") });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await getSupabase();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: callbackUrl("/reset-password") });
  return {
    status: "success",
    message: "Si hay una cuenta con ese email, recibirás un enlace para elegir una contraseña nueva.",
  };
}

export async function resetPassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const user = await getUser();
  if (!user) {
    return { status: "error", message: "El enlace ha caducado. Solicita uno nuevo desde «Olvidé mi contraseña»." };
  }
  const parsed = ResetPasswordSchema.safeParse({ password: text(formData, "password"), confirm: text(formData, "confirm") });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await getSupabase();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: "Elige una contraseña más segura (mezcla letras y números)." } };
    }
    if (error.code === "same_password") {
      return { status: "error", fieldErrors: { password: "La contraseña nueva debe ser distinta de la actual." } };
    }
    return { status: "error", message: GENERIC_ERROR };
  }
  redirect("/app");
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabase();
  await supabase.auth.signOut();
  redirect("/");
}
