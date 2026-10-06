// Concatena las migraciones y el seed en supabase/setup.sql para pegarlo en el SQL Editor de Supabase.
// La fuente de verdad sigue siendo supabase/migrations/ y supabase/seed.sql.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const migrationsDir = path.join(root, "supabase/migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => path.join(migrationsDir, f));
files.push(path.join(root, "supabase/seed.sql"));

const header = `-- ============================================================================
-- Adaptaula · instalación completa de la base de datos
-- Generado por scripts/build-setup-sql.mjs (no editar a mano).
-- Pégalo entero en Supabase → SQL Editor → Run, en un proyecto NUEVO.
-- Si algo falla, la transacción se revierte y no queda nada a medias.
-- ============================================================================

begin;
`;

const body = files
  .map((f) => `\n-- >>> ${path.relative(root, f)}\n\n${readFileSync(f, "utf8").trim()}\n`)
  .join("");

const out = path.join(root, "supabase/setup.sql");
writeFileSync(out, `${header}${body}\ncommit;\n`);
console.log(`Escrito ${path.relative(root, out)} (${files.length} ficheros)`);
