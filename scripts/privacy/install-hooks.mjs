/**
 * Activa los hooks versionados de `.githooks` (control de privacidad antes de cada commit, ADR-044). Se ejecuta en
 * `prepare`; fuera de un checkout de Git (Vercel, imagen de CI sin .git) no hace nada y nunca rompe la instalación.
 */
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
  console.log("hooks de Git activados (.githooks: control de privacidad antes de cada commit)");
} catch {
  // Not a Git checkout, or Git is unavailable: nothing to install.
}
