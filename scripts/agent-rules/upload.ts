/**
 * Sube las reglas pedagógicas privadas al bucket privado `agent-rules` (ADR-045). Por defecto SOLO VERIFICA: comprueba cada archivo
 * de la copia local contra el manifiesto de huellas versionado y no sube nada. Para subir hace falta `--upload` y la clave de
 * servicio en el entorno; el script nunca imprime el contenido de las reglas.
 *
 *   node --import tsx scripts/agent-rules/upload.ts <carpeta-privada>             verificar
 *   node --env-file=.env.local --import tsx scripts/agent-rules/upload.ts <carpeta-privada> --upload
 *
 * La carpeta debe estar fuera de cualquier repositorio Git.
 */
import { createClient } from "@supabase/supabase-js";
import { loadAgentRules, readVerified } from "../../src/lib/agent-rules/loader";
import { AGENT_RULES_V22 } from "../../src/lib/agent-rules/manifest-v22";
import { directoryRulesSource } from "../../src/lib/agent-rules/local-source";
import { AGENT_RULES_BUCKET } from "../../src/lib/agent-rules/sources";

async function main() {
  const [dir, flag] = process.argv.slice(2);
  if (!dir) throw new Error("Uso: upload.ts <carpeta-privada> [--upload]");
  const manifest = AGENT_RULES_V22;
  const source = await directoryRulesSource(dir);
  const paths = Object.keys(manifest.files).sort();
  for (const p of paths) await readVerified(source, manifest, p);
  await loadAgentRules(source, manifest);
  console.log(`✓ ${paths.length} archivos de ${manifest.version} coinciden con el manifiesto (paquete ${manifest.package_sha256.slice(0, 12)}…)`);
  if (flag !== "--upload") {
    console.log("Solo verificación: no se ha subido nada (añade --upload para subir).");
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY.");
  const storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(AGENT_RULES_BUCKET);
  for (const p of paths) {
    const bytes = await source.read(p);
    const { error } = await storage.upload(`${manifest.version}/${p}`, bytes!, { contentType: p.endsWith(".json") ? "application/json" : "text/markdown", upsert: true });
    if (error) throw new Error(`No se pudo subir ${p}: ${error.message}`);
  }
  console.log(`✓ Subidos ${paths.length} archivos a ${AGENT_RULES_BUCKET}/${manifest.version}/. Verifica la carga en el servidor con AGENT_RULES_SOURCE=storage.`);
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : "error desconocido"}`);
  process.exit(1);
});
