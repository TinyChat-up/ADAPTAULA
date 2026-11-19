#!/usr/bin/env node
// Copia una ejecución grabada de la evaluación (evals/results/recreation/<carpeta>) a la demostración /demo/recreacion.
// Solo lee ficheros bajo esa carpeta y escribe en src/app/demo/recreacion/data: sin llamadas de IA. Para volver a la demostración
// del estanque: git checkout -- src/app/demo/recreacion/data
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const run = process.argv[2];
if (!run) {
  console.error("Uso: pnpm demo:recreacion evals/results/recreation/<carpeta>");
  process.exit(1);
}
const results = path.resolve("evals/results/recreation");
const dir = path.resolve(run);
if (!dir.startsWith(results + path.sep)) {
  console.error("La carpeta debe estar dentro de evals/results/recreation.");
  process.exit(1);
}
for (const f of ["line.json", "version.json"]) {
  if (!existsSync(path.join(dir, f))) {
    console.error(`Falta ${f} en ${run}.`);
    process.exit(1);
  }
}
const target = path.resolve("src/app/demo/recreacion/data");
writeFileSync(path.join(target, "line.json"), readFileSync(path.join(dir, "line.json")));
writeFileSync(path.join(target, "version.json"), readFileSync(path.join(dir, "version.json")));
const assets = {};
const assetsDir = path.join(dir, "assets");
if (existsSync(assetsDir)) for (const f of readdirSync(assetsDir)) if (f.endsWith(".png")) assets[f.slice(0, -4)] = readFileSync(path.join(assetsDir, f)).toString("base64");
writeFileSync(path.join(target, "assets.json"), `${JSON.stringify(assets)}\n`);
console.log(`Demostración actualizada con ${run}. Arranca con: ADAPTAULA_DEMO=1 pnpm dev  →  /demo/recreacion`);
