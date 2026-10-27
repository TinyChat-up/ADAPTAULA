import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { password, signUpAndOnboard, uniqueEmail, workspaceOf } from "./helpers";

// Run after restarting the LOCAL test database with 032, separately from a suite already in progress on 031.
const local = ["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_BASE_URL ?? "http://localhost:3100").hostname);
test.skip(!local || process.env.CHECK_PROFILE_VERSION_GUARD !== "1", "Requiere arranque exclusivamente local con la migración 032.");

test("032: un cliente antiguo autenticado no puede borrar observaciones mediante REST directo", async ({ page }) => {
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  await page.getByLabel("Alias o iniciales").fill("Guardia ficticia");
  await page.getByLabel("Etapa", { exact: true }).selectOption("primaria");
  await page.getByLabel("Curso", { exact: true }).selectOption("4-primaria");
  await page.getByText("Fortalezas · ¿Qué se le da bien?", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Explica oralmente lo que sabe.", exact: true }).check();
  await page.getByRole("button", { name: "Crear perfil", exact: true }).click();
  await expect(page).toHaveURL(/aviso=creado/);
  await page.getByRole("link", { name: /Guardia ficticia/ }).click();
  await expect(page).toHaveURL(/\/app\/alumnos\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").at(-1)!, ws = await workspaceOf(page, email);
  const client = createClient("http://127.0.0.1:54399", "sb_publishable_fakefakefakefakefake", { auth: { persistSession: false, autoRefreshToken: false } });
  expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
  const old = { schema_version: 1, supports: {}, limits: {}, allowances: {} };
  const result = await client.from("learner_profiles").update({ functional_profile: old }).eq("workspace_id", ws).eq("id", id);
  expect(result.error?.message).toContain("profile_version_downgrade");
  const { data, error } = await client.from("learner_profiles").select("functional_profile").eq("id", id).single();
  expect(error).toBeNull();
  expect(data?.functional_profile).toMatchObject({ schema_version: 2, observations: { strengths: ["oral_expression"] } });
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Resumen del perfil" })).toContainText("Explica oralmente lo que sabe.");
});
