/**
 * Sube las reglas pedagógicas privadas al bucket privado `agent-rules` (ADR-045). Por defecto SOLO VERIFICA: comprueba cada archivo
 * de la copia local contra el manifiesto de huellas versionado y no sube nada. Para subir hace falta `--upload` y la clave de
 * servicio en el entorno; el script nunca imprime el contenido de las reglas.
 *
 *   node --import tsx scripts/agent-rules/upload.ts <carpeta-privada>             verificar
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/agent-rules/upload.ts <carpeta-privada> --upload
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/agent-rules/upload.ts --verify-remote
 *
 * `--verify-remote` no necesita la copia local: descarga del bucket cada archivo con la clave de servicio, comprueba tamaño y SHA-256
 * contra el manifiesto y la huella del paquete, y confirma que la clave pública (anon) NO puede leer ni listar nada. No imprime contenido.
 *
 * La carpeta debe estar fuera de cualquier repositorio Git.
 */
import { createClient } from "@supabase/supabase-js";
import { loadAgentRules, readVerified } from "../../src/lib/agent-rules/loader";
import { AGENT_RULES_V22 } from "../../src/lib/agent-rules/manifest-v22";
import { directoryRulesSource } from "../../src/lib/agent-rules/local-source";
import { AGENT_RULES_BUCKET } from "../../src/lib/agent-rules/sources";

function adminStorage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(AGENT_RULES_BUCKET);
}

async function verifyRemote() {
  const manifest = AGENT_RULES_V22;
  const bucket = adminStorage();
  const source = {
    kind: "storage" as const,
    async read(file: string) {
      const { data, error } = await bucket.download(`${manifest.version}/${file}`);
      return error || !data ? null : new Uint8Array(await data.arrayBuffer());
    },
  };
  const paths = Object.keys(manifest.files).sort();
  for (const p of paths) await readVerified(source, manifest, p);
  await loadAgentRules(source, manifest);
  const { data: listed } = await bucket.list(manifest.version, { limit: 1000 });
  const extra = (listed ?? []).filter((f) => f.id !== null).length;
  console.log(`✓ Servidor: ${paths.length} archivos con tamaño y SHA-256 iguales al manifiesto; paquete ${manifest.package_sha256.slice(0, 12)}… coincide (${extra} archivos en ${manifest.version}/ del primer nivel).`);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!anonKey) throw new Error("Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para la prueba de acceso anónimo.");
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(AGENT_RULES_BUCKET);
  const first = `${manifest.version}/${paths[0]}`;
  const read = await anon.download(first);
  const publicUrl = await fetch(`${url}/storage/v1/object/public/${AGENT_RULES_BUCKET}/${first}`);
  const { data: anonList } = await anon.list(manifest.version, { limit: 10 });
  if (read.data || publicUrl.ok || (anonList?.length ?? 0) > 0) throw new Error("¡El acceso anónimo a agent-rules NO está bloqueado!");
  console.log("✓ Acceso anónimo: no puede descargar, ni por URL pública, ni listar el bucket.");
}

async function main() {
  const [dir, flag] = process.argv.slice(2);
  if (dir === "--verify-remote") return verifyRemote();
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
  const storage = adminStorage();
  for (const p of paths) {
    const bytes = await source.read(p);
    const { error } = await storage.upload(`${manifest.version}/${p}`, bytes!, { contentType: p.endsWith(".json") ? "application/json" : "text/markdown", upsert: true });
    if (error) throw new Error(`No se pudo subir ${p}: ${error.message}`);
  }
  console.log(`✓ Subidos ${paths.length} archivos a ${AGENT_RULES_BUCKET}/${manifest.version}/. Verifícalo con --verify-remote.`);
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : "error desconocido"}`);
  process.exit(1);
});
