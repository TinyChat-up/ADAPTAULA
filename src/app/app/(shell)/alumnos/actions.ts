"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireWorkspace, WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { checkEntitlement } from "@/lib/permissions/check-entitlement";
import { isValidStageGrade } from "@/lib/profiles/catalog";
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  getCatalog,
  updateProfile,
  type WriteResult,
} from "@/lib/profiles/repository";
import { fieldErrorsFrom } from "@/lib/schemas/auth";
import { LearnerProfileInputSchema, type LearnerProfileInput } from "@/lib/schemas/learner-profile";

export type ProfileActionResult =
  | { ok: false; code: "validation"; message: string; fieldErrors: Partial<Record<string, string>> }
  | { ok: false; code: "limit" | "not_found" | "forbidden" | "error"; message: string };

const MESSAGES = {
  limit: "Has alcanzado el límite de perfiles de tu plan.",
  not_found: "No hemos encontrado ese perfil.",
  forbidden: "Tu rol no permite modificar perfiles.",
  error: "No hemos podido guardar los cambios. Inténtalo de nuevo.",
} as const;

function failure(code: keyof typeof MESSAGES): ProfileActionResult {
  return { ok: false, code, message: MESSAGES[code] };
}

async function validate(
  input: unknown,
): Promise<{ ok: true; data: LearnerProfileInput } | { ok: false; result: ProfileActionResult }> {
  const parsed = LearnerProfileInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      result: { ok: false, code: "validation", message: "Revisa los campos marcados.", fieldErrors: fieldErrorsFrom(parsed.error) },
    };
  }
  const catalog = await getCatalog();
  if (!isValidStageGrade(catalog, parsed.data.stage_slug, parsed.data.grade_slug)) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "validation",
        message: "Revisa los campos marcados.",
        fieldErrors: { grade_slug: "Elige un curso que pertenezca a la etapa." },
      },
    };
  }
  return { ok: true, data: parsed.data };
}

function fromWrite(result: WriteResult): ProfileActionResult | null {
  return result.ok ? null : failure(result.reason);
}

export async function createProfileAction(input: unknown): Promise<ProfileActionResult> {
  return createAndGo(input, null);
}

/**
 * The same creation, started from a material ("Adaptar este material" → "Crear un perfil"): the teacher goes back to that material
 * with the new profile chosen. The material id is bound on the server page after checking the material is visible to this user;
 * it is re-validated here and only ever used to build a path inside the app.
 */
export async function createProfileForMaterialAction(materialId: string, input: unknown): Promise<ProfileActionResult> {
  return createAndGo(input, z.uuid().safeParse(materialId).success ? materialId : null);
}

async function createAndGo(input: unknown, materialId: string | null): Promise<ProfileActionResult> {
  const ctx = await requireWorkspace();
  if (!hasRole(ctx.role, WRITE_ROLES)) return failure("forbidden");

  const checked = await validate(input);
  if (!checked.ok) return checked.result;

  const entitlement = await checkEntitlement(ctx, "profile.create");
  if (!entitlement.allowed) return failure(entitlement.reason === "role" ? "forbidden" : "limit");

  const created = await createProfile(ctx, checked.data);
  const failed = fromWrite(created);
  if (failed || !created.ok) return failed ?? failure("error");
  revalidatePath("/app/alumnos");
  redirect(materialId ? `/app/materiales/${materialId}?perfil=${created.id}#adaptar` : "/app/alumnos?aviso=creado");
}

export async function updateProfileAction(id: string, input: unknown): Promise<ProfileActionResult> {
  const ctx = await requireWorkspace();
  if (!hasRole(ctx.role, WRITE_ROLES)) return failure("forbidden");

  const checked = await validate(input);
  if (!checked.ok) return checked.result;

  const failed = fromWrite(await updateProfile(ctx.workspace.id, id, checked.data));
  if (failed) return failed;
  revalidatePath("/app/alumnos");
  redirect("/app/alumnos?aviso=guardado");
}

export async function deleteProfileAction(id: string): Promise<ProfileActionResult> {
  const ctx = await requireWorkspace();
  if (!hasRole(ctx.role, WRITE_ROLES)) return failure("forbidden");

  const failed = fromWrite(await deleteProfile(ctx.workspace.id, id));
  if (failed) return failed;
  revalidatePath("/app/alumnos");
  redirect("/app/alumnos?aviso=eliminado");
}

export async function duplicateProfileAction(id: string): Promise<ProfileActionResult> {
  const ctx = await requireWorkspace();
  if (!hasRole(ctx.role, WRITE_ROLES)) return failure("forbidden");

  const entitlement = await checkEntitlement(ctx, "profile.create");
  if (!entitlement.allowed) return failure(entitlement.reason === "role" ? "forbidden" : "limit");

  const result = await duplicateProfile(ctx, id);
  if (!result.ok) return failure(result.reason);
  revalidatePath("/app/alumnos");
  redirect(`/app/alumnos/${result.id}?aviso=duplicado`);
}
