import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import { redactSecrets } from "@/lib/security/redact";
import { findSecrets, secretEnvValues } from "@/lib/security/secret-scan";

const ROOT = path.resolve(import.meta.dirname, "../..");
// Shaped like real keys but made up for the test.
const FAKE_ANTHROPIC = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0123456789";
const FAKE_OPENAI = "sk-proj-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0123456789abc";

describe("secret detection (what the post-build gate relies on)", () => {
  it("finds a real value, a key shape and a variable name, and reports labels instead of the secret", () => {
    const values = secretEnvValues({ ANTHROPIC_API_KEY: "valor-secreto-largo-1234567890", CRON_SECRET: "corto" });
    expect(values.map((v) => v.name)).toEqual(["ANTHROPIC_API_KEY"]); // too short to be a credential: ignored

    const bundle = `var a="valor-secreto-largo-1234567890";var b="${FAKE_ANTHROPIC}";var c=process.env.ANTHROPIC_API_KEY`;
    const hits = findSecrets(bundle, { values, names: true });
    expect(hits).toEqual(expect.arrayContaining(["valor de ANTHROPIC_API_KEY", "clave con forma de Anthropic (sk-ant-…)", "nombre ANTHROPIC_API_KEY"]));
    expect(JSON.stringify(hits)).not.toContain("valor-secreto-largo");
    expect(JSON.stringify(hits)).not.toContain(FAKE_ANTHROPIC);
  });

  it("recognizes OpenAI, Supabase and Stripe key shapes and leaves ordinary code alone", () => {
    expect(findSecrets(FAKE_OPENAI)).toHaveLength(1);
    expect(findSecrets("sb_secret_FAKEFAKEFAKEFAKEFAKE")).toHaveLength(1);
    expect(findSecrets("sk_live_FAKEFAKEFAKEFAKEFAKE")).toHaveLength(1);
    expect(findSecrets("const sk = 1; const task = 'sk-1'; NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")).toEqual([]);
  });

  it("flags variable names only when asked (server code legitimately mentions them)", () => {
    expect(findSecrets("process.env.ANTHROPIC_API_KEY")).toEqual([]);
    expect(findSecrets("process.env.ANTHROPIC_API_KEY", { names: true })).toEqual(["nombre ANTHROPIC_API_KEY"]);
  });
});

describe("logs, errors and results never carry a key", () => {
  afterEach(() => vi.restoreAllMocks());

  it("redactSecrets masks provider keys and bearer tokens inside any text", () => {
    const text = redactSecrets(`fallo 401 con ${FAKE_ANTHROPIC} y ${FAKE_OPENAI}; Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456`);
    expect(text).not.toContain("FAKEFAKE");
    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).toContain("[redactado]");
  });

  it("the logger drops fields named like secrets and masks key-shaped values in the rest", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("proveedor_rechazo", { jobId: "job-1", apiKey: FAKE_ANTHROPIC, authorization: "Bearer x", detail: `rechazada ${FAKE_ANTHROPIC}`, code: "auth" });
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).not.toContain("FAKEFAKE");
    expect(line).not.toContain("apiKey");
    expect(JSON.parse(line)).toMatchObject({ event: "proveedor_rechazo", jobId: "job-1", code: "auth" });
  });

  it("no stored eval result, if any exists, contains a key", () => {
    const dir = path.join(ROOT, "evals/results");
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      expect(findSecrets(readFileSync(path.join(dir, file), "utf8")), file).toEqual([]);
    }
  });
});

describe("secrets stay out of the client and out of git", () => {
  const gitignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n").map((l) => l.trim());

  it("every .env file is ignored except the example, and .env.local is never re-included", () => {
    expect(gitignore).toContain(".env*");
    expect(gitignore.filter((l) => l.startsWith("!") && l.includes(".env"))).toEqual(["!.env.example"]);
  });

  it("git does not track .env.local", () => {
    let tracked = "";
    try {
      tracked = execFileSync("git", ["ls-files", ".env.local", ".env", ".env.production"], { cwd: ROOT, encoding: "utf8" });
    } catch {
      return; // not a git checkout: nothing to verify
    }
    expect(tracked.trim()).toBe("");
  });

  it("real worksheets and their results are git-ignored, as are eval results", () => {
    expect(gitignore).toContain("evals/material-analysis/private/");
    expect(gitignore).toContain("evals/results/");
  });

  it(".env.example holds no value for any secret and no secret behind a NEXT_PUBLIC_ name", () => {
    const lines = readFileSync(path.join(ROOT, ".env.example"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l));
    for (const line of lines) {
      const [name, value = ""] = line.split("=");
      if (/^NEXT_PUBLIC_/.test(name!)) expect(name, "una variable pública no puede ser un secreto").not.toMatch(/SECRET|SERVICE_ROLE|API_KEY|PRIVATE|WEBHOOK|ANTHROPIC|OPENAI/);
      if (/SECRET|API_KEY|WEBHOOK/.test(name!)) expect(value.trim(), `${name} debe ir vacío en el ejemplo`).toBe("");
    }
  });

  it("no source file exposes a provider key through a NEXT_PUBLIC_ variable", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const offenders = walk(path.join(ROOT, "src"))
      .filter((f) => /NEXT_PUBLIC_[A-Z_]*(ANTHROPIC|OPENAI|SECRET_KEY|SERVICE_ROLE)/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
