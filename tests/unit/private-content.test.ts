import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspect, loadFingerprints } from "../../scripts/privacy/check-private-content.mjs";
import { fileHash, forbiddenPath, normalize, unitHash, units } from "../../scripts/privacy/fingerprint-lib.mjs";

/**
 * ADR-044: the private V2.2 rules, the precedent library, the laboratory and the real test materials never enter the public
 * repository. These tests use synthetic sentences only; the real fingerprints are opaque hashes.
 */
const SYNTHETIC = "Esta es una frase sintética de prueba que imita un documento privado del laboratorio";
const synthetic = () => ({ files: new Set([fileHash(Buffer.from("archivo privado sintético"))]), units: new Set([...units(SYNTHETIC)].map(unitHash)) });

describe("control de material privado", () => {
  it("reconoce una frase privada aunque cambien mayúsculas, tildes, signos y espacios", () => {
    const copy = Buffer.from(`# Título\n\n${SYNTHETIC.toUpperCase().replace("sintética", "sintetica").replace(/ /g, "  ")}.\n`);
    expect(inspect("docs/nuevo.md", copy, synthetic())).toEqual(["1 frase(s) de un documento privado"]);
  });

  it("reconoce una frase privada partida en varias líneas", () => {
    const words = SYNTHETIC.split(" ");
    const wrapped = Buffer.from(`${words.slice(0, 7).join(" ")}\n${words.slice(7).join(" ")}.\n`);
    expect(inspect("docs/nuevo.md", wrapped, synthetic())).toEqual(["1 frase(s) de un documento privado"]);
  });

  it("reconoce la copia exacta de un archivo privado", () => {
    expect(inspect("public/x.bin", Buffer.from("archivo privado sintético"), synthetic())).toContain("copia exacta de un archivo privado");
  });

  it("no informa del texto encontrado, solo del tipo de coincidencia", () => {
    const report = inspect("docs/nuevo.md", Buffer.from(SYNTHETIC), synthetic()).join(" ");
    expect(normalize(report)).not.toContain(normalize(SYNTHETIC).slice(0, 20));
  });

  it("no marca frases cortas ni texto propio", () => {
    expect(inspect("docs/nuevo.md", Buffer.from("Prueba de pista P8.\nEspacios homogéneos.\n"), synthetic())).toEqual([]);
  });

  it.each([
    ["materiales/MAT-007.pdf", true],
    ["materiales/esperados/x.json", true],
    ["paquete/adaptaula-lab.bundle", true],
    ["reglas/AGENTE_PEDAGOGICO_V2_2.zip", true],
    ["x/06_biblioteca/casos/D002-R01.md", true],
    ["docs/D001-E03.md", true],
    ["src/app/app/(shell)/materiales/page.tsx", false],
    ["src/lib/adaptation/decision-ledger.ts", false],
  ])("ruta %s reservada: %s", (path, reserved) => {
    expect(forbiddenPath(path) !== null).toBe(reserved);
  });

  it("las huellas versionadas no contienen texto", () => {
    const raw = readFileSync("scripts/privacy/private-fingerprints.json", "utf8");
    const data = JSON.parse(raw) as { files_sha256: string[]; units_sha256_64: string[] };
    expect(data.files_sha256.every((h) => /^[a-f0-9]{64}$/.test(h))).toBe(true);
    expect(data.units_sha256_64.every((h) => /^[a-f0-9]{16}$/.test(h))).toBe(true);
    expect(data.units_sha256_64.length).toBeGreaterThan(1000);
  });

  it("ningún archivo versionado contiene material privado", () => {
    const fp = loadFingerprints();
    const files = execFileSync("git", ["ls-files", "-z"]).toString().split("\0").filter(Boolean);
    const problems = files.flatMap((f) => inspect(f, existsSync(f) ? readFileSync(f) : null, fp).map((p) => `${f}: ${p}`));
    expect(problems).toEqual([]);
  });

  it("el hook de pre-commit y la CI ejecutan el control", () => {
    expect(readFileSync(".githooks/pre-commit", "utf8")).toContain("check-private-content.mjs --staged");
    const ci = readFileSync(".github/workflows/privacidad.yml", "utf8");
    expect(ci).toContain("check-private-content.mjs --range");
    expect(ci).toContain("fetch-depth: 0");
    expect(ci).not.toMatch(/secrets\./);
  });
});
