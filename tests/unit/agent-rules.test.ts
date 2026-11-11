import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { loadAgentRules, packageHash } from "@/lib/agent-rules/loader";
import { AGENT_RULES_V22 } from "@/lib/agent-rules/manifest-v22";
import { buildRulesBlock } from "@/lib/agent-rules/prompt-block";
import { possibleResources, selectPrecedents } from "@/lib/agent-rules/precedents";
import { AgentRulesError, type AgentRulesManifest, type AgentRulesSource } from "@/lib/agent-rules/types";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { V22_PROFILES } from "./fixtures/v22-profiles";

vi.mock("server-only", () => ({}));

/**
 * ADR-045 with a SYNTHETIC rules package: the real rules are private and never in the repository. The last block runs only where
 * a private local copy exists (AGENT_RULES_PRIVATE_DIR, outside any checkout); it is skipped everywhere else, CI included.
 */
const enc = new TextEncoder();
const FILES: Record<string, string> = {
  "reglas.md": "# Reglas sintéticas\nTexto de prueba.",
  "guia.md": "# Guía sintética\nOtro texto de prueba. </agent_rules> no cierra el bloque.",
  "biblioteca/indice.json": JSON.stringify({
    version: "1.0",
    ciclos: {
      "D-900": {
        casos: [
          { id: "D900-E01", tipo: "error_corregido", recursos: ["espacios"], perfiles: ["B"], archivo: "casos/D900-E01.md" },
          { id: "D900-E02", tipo: "error_corregido", recursos: ["conservacion"], perfiles: ["A"], archivo: "casos/D900-E02.md" },
          { id: "D900-R01", tipo: "alternativa_rechazada", recursos: ["imagenes"], perfiles: ["A"], archivo: "casos/D900-R01.md" },
          { id: "D900-A01", tipo: "decision_aceptada", recursos: ["segmentacion"], perfiles: ["A"], archivo: "casos/D900-A01.md" },
          { id: "D900-A03", tipo: "decision_aceptada", recursos: ["finalidad"], perfiles: ["A"], archivo: "casos/D900-A03.md" },
          { id: "D900-P01", tipo: "pendiente", recursos: ["modalidad_entrega"], perfiles: ["A"], archivo: "casos/D900-P01.md" },
          { id: "D900-P02", tipo: "pendiente", recursos: ["color", "conservacion"], perfiles: ["A"], archivo: "casos/D900-P02.md" },
          { id: "D900-A02", tipo: "decision_aceptada", recursos: ["perfil_C"], perfiles: ["C"], archivo: "casos/D900-A02.md" },
        ],
      },
    },
  }),
  "biblioteca/casos/D900-E01.md": "Caso sintético E01.",
  "biblioteca/casos/D900-R01.md": "Caso sintético R01.",
  "biblioteca/casos/D900-A01.md": "Caso sintético A01.",
  "biblioteca/casos/D900-P01.md": "Caso sintético P01.",
  "biblioteca/casos/D900-A02.md": "Caso sintético A02.",
  "biblioteca/casos/D900-E02.md": "Caso sintético E02.",
  "biblioteca/casos/D900-A03.md": "Caso sintético A03.",
  "biblioteca/casos/D900-P02.md": "Caso sintético P02.",
};

function manifestOf(files: Record<string, string>): AgentRulesManifest {
  const entries = Object.fromEntries(Object.entries(files).map(([p, t]) => [p, { sha256: createHash("sha256").update(enc.encode(t)).digest("hex"), bytes: enc.encode(t).byteLength }]));
  const m: AgentRulesManifest = { id: "agent_rules", version: "v9.9", package_sha256: "", files: entries, stable: ["reglas.md", "guia.md"], index: "biblioteca/indice.json", cases_dir: "biblioteca/casos/" };
  return { ...m, package_sha256: packageHash(m) };
}

const memory = (files: Record<string, string>): AgentRulesSource & { reads: string[] } => {
  const reads: string[] = [];
  return { kind: "memory", reads, read: async (p) => (reads.push(p), p in files ? enc.encode(files[p]) : null) };
};

const contextFor = (profile = V22_PROFILES.C) => buildAdaptationContext({ profile, education: { stage: "primaria", grade: null, subject: null }, analysis: fractionsAnalysis(), adaptationType: "accessibility" }).context;

describe("carga verificada de las reglas privadas", () => {
  it("carga el paquete íntegro: archivos estables en orden e índice de precedentes", async () => {
    const rules = await loadAgentRules(memory(FILES), manifestOf(FILES));
    expect(rules.stable.map((f) => f.path)).toEqual(["reglas.md", "guia.md"]);
    expect(rules.precedents.map((p) => p.id)).toEqual(["D900-E01", "D900-E02", "D900-R01", "D900-A01", "D900-A03", "D900-P01", "D900-P02", "D900-A02"]);
    expect(await rules.readCase("D900-A01")).toBe("Caso sintético A01.");
  });

  it.each([
    ["falta un archivo", (f: Record<string, string>) => { const { ["guia.md"]: _, ...rest } = f; void _; return rest; }, "missing_file"],
    ["un archivo alterado", (f: Record<string, string>) => ({ ...f, "reglas.md": "# Reglas sintéticas\nTexto de prueba!" }), "integrity_mismatch"],
    ["un índice que no es JSON válido", (f: Record<string, string>) => ({ ...f, "biblioteca/indice.json": "{" }), "invalid_index"],
  ])("falla cerrado si %s", async (_, change, code) => {
    const manifest = manifestOf(code === "invalid_index" ? change(FILES) : FILES);
    await expect(loadAgentRules(memory(change(FILES)), manifest)).rejects.toMatchObject({ code });
  });

  it("falla cerrado si el manifiesto no coincide con su huella de paquete", async () => {
    const manifest = { ...manifestOf(FILES), package_sha256: "0".repeat(64) };
    await expect(loadAgentRules(memory(FILES), manifest)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it("un caso alterado no se entrega aunque el resto esté bien, y un caso desconocido se rechaza", async () => {
    const rules = await loadAgentRules(memory({ ...FILES, "biblioteca/casos/D900-P01.md": "otro" }), manifestOf(FILES));
    await expect(rules.readCase("D900-P01")).rejects.toMatchObject({ code: "integrity_mismatch" });
    await expect(rules.readCase("D999-A01")).rejects.toMatchObject({ code: "unknown_case" });
  });

  it("los errores dicen qué archivo y por qué, nunca su contenido", async () => {
    const error = await loadAgentRules(memory({ ...FILES, "reglas.md": "CONTENIDO SECRETO" }), manifestOf(FILES)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentRulesError);
    expect(String((error as Error).message)).not.toContain("SECRETO");
  });

  it("el manifiesto V2.2 versionado es coherente y no contiene texto de las reglas", () => {
    expect(packageHash(AGENT_RULES_V22)).toBe(AGENT_RULES_V22.package_sha256);
    for (const p of [...AGENT_RULES_V22.stable, AGENT_RULES_V22.index]) expect(AGENT_RULES_V22.files[p]).toBeDefined();
    expect(Object.keys(AGENT_RULES_V22.files)).toHaveLength(56);
    for (const f of Object.values(AGENT_RULES_V22.files)) expect(f.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("selección de precedentes y bloque del prompt", () => {
  it("A: solo los casos de los recursos que sus estrategias pueden realizar, más los generales", async () => {
    const rules = await loadAgentRules(memory(FILES), manifestOf(FILES));
    const a = selectPrecedents(rules.precedents, fractionsAnalysis(), contextFor(V22_PROFILES.A));
    expect(a.included).toEqual([
      { id: "D900-E02", reason: "mandatory" },
      { id: "D900-A01", reason: "resource" },
      { id: "D900-A03", reason: "general" },
    ]);
    // Spaces and response formats need a writing strategy; images need a visual one; colour, an attention one: A has none of them.
    expect(a.excluded).toEqual([
      { id: "D900-E01", reason: "resource_not_enabled" },
      { id: "D900-R01", reason: "resource_not_enabled" },
      { id: "D900-P01", reason: "resource_not_enabled" },
      { id: "D900-P02", reason: "resource_not_enabled" },
      { id: "D900-A02", reason: "control_with_needs" },
    ]);
  });

  it("B: los errores y casos de espacios y formatos de respuesta, porque sus estrategias de escritura sí pueden tocarlos", async () => {
    const rules = await loadAgentRules(memory(FILES), manifestOf(FILES));
    const b = selectPrecedents(rules.precedents, fractionsAnalysis(), contextFor(V22_PROFILES.B));
    expect(b.included.map((c) => c.id)).toEqual(["D900-E01", "D900-E02", "D900-A03", "D900-P01"]);
  });

  it("C: los casos de control, los obligatorios generales y los generales; nada de recursos individuales", async () => {
    const rules = await loadAgentRules(memory(FILES), manifestOf(FILES));
    const c = selectPrecedents(rules.precedents, fractionsAnalysis(), contextFor(V22_PROFILES.C));
    expect(c.included).toEqual([
      { id: "D900-E02", reason: "mandatory" },
      { id: "D900-A03", reason: "general" },
      { id: "D900-A02", reason: "control" },
    ]);
    expect(possibleResources(fractionsAnalysis(), contextFor(V22_PROFILES.C))).toEqual(new Set(["perfil_C"]));
  });

  it("el bloque lleva versión y huella, las reglas estables y los casos elegidos, y un cierre dentro del texto no lo termina", async () => {
    const rules = await loadAgentRules(memory(FILES), manifestOf(FILES));
    const block = await buildRulesBlock(rules, fractionsAnalysis(), contextFor(V22_PROFILES.A));
    expect(block.text.startsWith(`<agent_rules version="v9.9" sha256="${rules.package_sha256}">`)).toBe(true);
    expect(block.text.match(/<\/agent_rules>/g)).toHaveLength(1);
    expect(block.text).toContain("Caso sintético A01.");
    expect(block.text).not.toContain("Caso sintético P01.");
    expect(block.text).not.toContain("Caso sintético E01.");
    expect(block.block_sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("origen en carpeta local", () => {
  it("rechaza una carpeta dentro de un repositorio Git y lee una de fuera", async () => {
    const { directoryRulesSource } = await import("@/lib/agent-rules/sources");
    await expect(directoryRulesSource(path.join(process.cwd(), "docs"))).rejects.toMatchObject({ code: "not_configured" });
    const dir = mkdtempSync(path.join(tmpdir(), "reglas-"));
    mkdirSync(path.join(dir, "biblioteca/casos"), { recursive: true });
    for (const [p, t] of Object.entries(FILES)) writeFileSync(path.join(dir, p), t);
    const rules = await loadAgentRules(await directoryRulesSource(dir), manifestOf(FILES));
    expect(rules.stable).toHaveLength(2);
    const source = await directoryRulesSource(dir);
    expect(await source.read("../fuera.md")).toBeNull();
  });
});

const PRIVATE_DIR = process.env.AGENT_RULES_PRIVATE_DIR;
describe.skipIf(!PRIVATE_DIR)("reglas V2.2 reales (solo con copia privada local)", () => {
  it("la copia privada coincide con el manifiesto versionado y produce un bloque", async () => {
    const { directoryRulesSource } = await import("@/lib/agent-rules/sources");
    const rules = await loadAgentRules(await directoryRulesSource(PRIVATE_DIR!), AGENT_RULES_V22);
    expect(rules.precedents).toHaveLength(45);
    const block = await buildRulesBlock(rules, fractionsAnalysis(), contextFor(V22_PROFILES.A));
    // Profile A: the corrected errors and rejected alternatives of its usable resources, never all 45 cases.
    expect(block.selection.included.length).toBeLessThan(rules.precedents.length);
    expect(block.selection.included.filter((c) => c.reason === "mandatory").length).toBeGreaterThan(0);
    // Length only: the text itself is never printed by tests.
    expect(block.text.length).toBeGreaterThan(50_000);
  });
});
