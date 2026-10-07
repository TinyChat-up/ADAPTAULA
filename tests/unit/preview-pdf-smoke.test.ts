import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import * as route from "@/app/api/preview-pdf-smoke/route";

/** VALIDATION ONLY (fix/vercel-pnpm-tracing; removed before the production PR): guards of the Preview-only PDF smoke endpoint. No Chromium is launched here. */

const call = (query: string) => route.GET(new Request(`https://preview.example/api/preview-pdf-smoke${query}`));
const original = process.env.VERCEL_ENV;
afterEach(() => {
  if (original === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = original;
});

describe("preview-pdf-smoke · guards", () => {
  it("404 outside a Vercel Preview (production, development, local)", async () => {
    for (const env of [undefined, "production", "development"]) {
      if (env === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = env;
      expect((await call("?fixture=basic")).status).toBe(404);
    }
  });

  it("400 for a fixture outside the closed enum, and for any url/path/file parameter", async () => {
    process.env.VERCEL_ENV = "preview";
    for (const q of ["", "?fixture=other", "?fixture=../../etc/passwd", "?fixture=basic&url=https://example.com", "?fixture=basic&path=/etc/passwd", "?fixture=basic&file=x.pdf"]) {
      expect((await call(q)).status, q).toBe(400);
    }
  });

  it("only GET is exported; no Supabase, session, Storage, env dump or model in the endpoint", () => {
    expect(Object.keys(route).filter((k) => /^(POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k))).toEqual([]);
    const src = readFileSync("src/app/api/preview-pdf-smoke/route.ts", "utf8") + readFileSync("src/app/api/preview-pdf-smoke/fixtures.ts", "utf8");
    expect(src).not.toMatch(/supabase|@\/lib\/auth|cookies\(|@\/lib\/ai|fetch\(|readAssetInstance|process\.env(?!\.VERCEL_ENV|\.VERCEL_REGION)/);
  });
});
