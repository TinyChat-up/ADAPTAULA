import { z } from "zod";

export const AccountNameSchema = z.object({
  full_name: z.string().trim().min(1, "Escribe el nombre que quieres mostrar.").max(120, "El nombre no puede superar los 120 caracteres."),
});

export type AccountNameState = {
  status: "idle" | "error" | "success";
  message?: string;
  error?: string;
};
