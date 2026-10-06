import { z } from "zod";

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "El email es demasiado largo.")
  .pipe(z.email("Escribe un email válido."));

const Password = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres.")
  .max(72, "La contraseña no puede superar los 72 caracteres.");

export const SignUpSchema = z.object({
  full_name: z.string().trim().max(120, "El nombre es demasiado largo.").optional(),
  email: Email,
  password: Password,
});

export const SignInSchema = z.object({
  email: Email,
  password: z.string().min(1, "Escribe tu contraseña.").max(72),
});

export const EmailOnlySchema = z.object({ email: Email });

export const ResetPasswordSchema = z
  .object({ password: Password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden." });

export interface AuthFormState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<string, string>>;
}

/** First message per field, ready for the UI. */
export function fieldErrorsFrom(error: z.ZodError): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
