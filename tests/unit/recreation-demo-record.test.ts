import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRecreation } from "@/lib/recreation/create";
import { MemoryRecreationStore, RecreationRecordSchema } from "@/lib/recreation/record";
import { mockStack } from "../support/recreation-mocks";

/**
 * The stored pond recreation the demo screen reads (`/demo/recreacion`, src/lib/recreation/demo/): produced ONCE by the simulated
 * route (simulated Claude and OpenAI, 0 paid calls) and kept in the repository with its picture, exactly as the product would keep it
 * in its table and private bucket. `WRITE_DEMO_RECORD=1` rewrites it; otherwise this test checks it is still what the route produces.
 */
const DIR = "src/lib/recreation/demo";

describe("registro de demostración del estanque", () => {
  it("es el que produce el recorrido simulado (determinista) y cumple el esquema del registro", async () => {
    const stack = mockStack({ imagesAuthorized: true });
    const store = new MemoryRecreationStore();
    const result = await createRecreation(
      { store, planner: stack.planner, canWrite: async () => true, entitlement: async () => ({ allowed: true }), budgetAllows: async () => true, newId: () => "66666666-6666-4666-8666-666666666666", now: () => "2026-11-18T10:00:00.000Z", runs: stack.runs },
      { ...stack.request, workspaceId: "11111111-1111-4111-8111-111111111111", materialId: "44444444-4444-4444-8444-444444444444" },
    );
    if (result.status !== "created") throw new Error(result.status);
    const record = result.record;
    const [asset] = record.assets;
    const png = stack.assets.get(asset!.asset_id)!.bytes;
    if (process.env.WRITE_DEMO_RECORD === "1" || !existsSync(`${DIR}/pond-record.json`)) {
      writeFileSync(`${DIR}/pond-record.json`, `${JSON.stringify(record, null, 1)}\n`);
      writeFileSync(`${DIR}/pond-illustration.png`, png);
    }
    const stored = RecreationRecordSchema.parse(JSON.parse(readFileSync(`${DIR}/pond-record.json`, "utf8")));
    expect(stored.explanation).toEqual(record.explanation);
    expect(stored.student.pages).toEqual(record.student.pages);
    expect(stored.assets.map((a) => a.sha256)).toEqual(record.assets.map((a) => a.sha256));
  });
});
