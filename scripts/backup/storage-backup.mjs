/**
 * Copia de los archivos privados de Supabase Storage (source-materials, generated-assets, exports) y verificación de integridad.
 * SOLO LECTURA sobre Supabase: lista y descarga; no escribe, no borra. Contiene datos de materiales y de fichas: el destino debe estar
 * FUERA de cualquier repositorio Git y en un disco cifrado. El script se niega a escribir dentro de un checkout de Git.
 *
 *   node --env-file=.env.backup scripts/backup/storage-backup.mjs backup   <carpeta-destino>
 *   node scripts/backup/storage-backup.mjs                          verify   <carpeta-copia>
 *
 * .env.backup (nunca en Git) lleva NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY del proyecto a copiar. El script no imprime ninguna
 * clave ni el contenido de ningún archivo; solo cuentas, tamaños y huellas.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const BUCKETS = ["source-materials", "generated-assets", "exports"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function insideGit(dir) {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

async function listAll(storage, bucket, prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await storage.from(bucket).list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`No se pudo listar ${bucket}/${prefix}: ${error.message}`);
    for (const item of data) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      // A folder has no id; a file does.
      if (item.id === null) files.push(...(await listAll(storage, bucket, full)));
      else files.push(full);
    }
    if (data.length < 100) break;
  }
  return files;
}

async function backup(dest) {
  const target = path.resolve(dest);
  mkdirSync(target, { recursive: true });
  if (insideGit(target)) throw new Error("El destino está dentro de un repositorio Git. Usa una carpeta fuera de cualquier checkout.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY (.env.backup).");
  const storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  const manifest = { version: 1, createdAt: new Date().toISOString(), host: new URL(url).hostname, buckets: {} };
  let total = 0;
  for (const bucket of BUCKETS) {
    const entries = [];
    for (const name of await listAll(storage, bucket)) {
      const { data, error } = await storage.from(bucket).download(name);
      if (error || !data) throw new Error(`No se pudo descargar ${bucket}/${name}`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      const file = path.join(target, bucket, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      entries.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
    }
    manifest.buckets[bucket] = entries;
    total += entries.length;
    console.log(`${bucket}: ${entries.length} archivos`);
  }
  writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Copia terminada: ${total} archivos. Compara esa cifra con «select count(*) from storage.objects» y verifica con «verify».`);
}

function verify(dir) {
  const root = path.resolve(dir);
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  let ok = 0;
  const problems = [];
  const expected = new Set();
  for (const [bucket, entries] of Object.entries(manifest.buckets)) {
    for (const e of entries) {
      const file = path.join(root, bucket, e.name);
      expected.add(file);
      if (!existsSync(file)) problems.push(`falta ${bucket}/${e.name}`);
      else if (sha256(readFileSync(file)) !== e.sha256 || statSync(file).size !== e.bytes) problems.push(`huella distinta ${bucket}/${e.name}`);
      else ok += 1;
    }
  }
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]));
  for (const f of walk(root)) if (!expected.has(f) && path.basename(f) !== "manifest.json") problems.push(`archivo no inventariado ${path.relative(root, f)}`);
  console.log(`${ok} archivos correctos de ${expected.size}; ${problems.length} problemas`);
  for (const p of problems.slice(0, 20)) console.log(`  · ${p}`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}

const [mode, dir] = process.argv.slice(2);
try {
  if (!dir) throw new Error("Uso: storage-backup.mjs backup|verify <carpeta>");
  if (mode === "backup") await backup(dir);
  else if (mode === "verify") verify(dir);
  else throw new Error("Modo desconocido: usa backup o verify");
} catch (error) {
  console.error(error instanceof Error ? error.message.replace(/sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]{20,}/g, "[clave]") : String(error));
  process.exitCode = 1;
}
