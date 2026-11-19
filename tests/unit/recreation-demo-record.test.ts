import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRecreation } from "@/lib/recreation/create";
import { MemoryRecreationStore, RecreationLineSchema, RecreationVersionSchema } from "@/lib/recreation/record";
import { mockStack } from "../support/recreation-mocks";

/**
 * The stored pond recreation the demo screen reads (`/demo/recreacion`, src/app/demo/recreacion/data/): produced ONCE by the simulated
 * route (simulated Claude and OpenAI, 0 paid calls) and kept as the product would keep what a member can read: the line, the
 * version WITHOUT answers and its approved pictures. The internal part (answers, plan, verification) is NOT in the repository.
 * `WRITE_DEMO_RECORD=1` rewrites it; otherwise this test checks it is still what the route produces.
 */
const DIR = "src/app/demo/recreacion/data";

describe("registro de demostración del estanque", () => {
  it("es el que produce el recorrido simulado, sin respuestas y con sus ilustraciones", async () => {
    const stack = mockStack({ imagesAuthorized: true });
    const store = new MemoryRecreationStore();
    let n = 0;
    const result = await createRecreation(
      { store, planner: stack.planner, canWrite: async () => true, quota: { reserve: async () => "reserved", refund: async () => undefined }, budgetAllows: async () => true, newId: () => `66666666-6666-4666-8666-${String(++n).padStart(12, "0")}`, now: () => "2026-11-18T10:00:00.000Z", runs: stack.runs },
      { ...stack.request, workspaceId: "11111111-1111-4111-8111-111111111111", materialId: "44444444-4444-4444-8444-444444444444", idempotencyKey: "demo-estanque-0001" },
    );
    if (result.status !== "created") throw new Error(result.status);
    if (process.env.WRITE_DEMO_RECORD === "1" || !existsSync(`${DIR}/version.json`)) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(`${DIR}/line.json`, `${JSON.stringify(result.line, null, 1)}\n`);
      writeFileSync(`${DIR}/version.json`, `${JSON.stringify(result.version, null, 1)}\n`);
      writeFileSync(`${DIR}/assets.json`, `${JSON.stringify(Object.fromEntries(result.version.assets.map((a) => [a.asset_id, Buffer.from(stack.assets.get(a.asset_id)!.bytes).toString("base64")])), null, 0)}\n`);
    }
    const line = RecreationLineSchema.parse(JSON.parse(readFileSync(`${DIR}/line.json`, "utf8")));
    const version = RecreationVersionSchema.parse(JSON.parse(readFileSync(`${DIR}/version.json`, "utf8")));
    const images = JSON.parse(readFileSync(`${DIR}/assets.json`, "utf8")) as Record<string, string>;
    expect(line.id).toBe(result.line.id);
    expect(version.explanation).toEqual(result.version.explanation);
    expect(version.student.pages).toEqual(result.version.student.pages);
    expect(version.assets.map((a) => a.sha256)).toEqual(result.version.assets.map((a) => a.sha256));
    expect(Object.keys(images).sort()).toEqual(version.assets.map((a) => a.asset_id).sort());
    // What is in the repository can be read by anyone with the code: no answer, no internal part.
    const files = ["line.json", "version.json"].map((f) => readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
    expect(files).not.toMatch(/30 − 18|Criterios|"verification"|"internal"|"answer_key": \[\s*\{/);
  });
});
