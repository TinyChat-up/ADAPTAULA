import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyFunctionalProfile } from "@/lib/schemas/functional-profile";
import { updateProfile } from "@/lib/profiles/repository";

const fakes = vi.hoisted(() => ({ from: vi.fn(), writes: vi.fn(), filters: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSupabase: async () => ({ from: fakes.from }) }));
const id = "11111111-1111-4111-8111-111111111111", ws = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-10-26T10:00:00.000Z";
const input = () => ({ display_name: "Alias", stage_slug: "primaria", grade_slug: "4-primaria", functional_profile: emptyFunctionalProfile() });
function setup(version: 1 | 2, matches = true) {
  const row = { id, display_name: "Alias", stage_slug: "primaria", grade_slug: "4-primaria", functional_profile: { ...emptyFunctionalProfile(), schema_version: version }, created_at: timestamp, updated_at: timestamp };
  fakes.from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { fakes.filters(key, value); return query; },
      is: () => query,
      update: (data: unknown) => { fakes.writes(data); return query; },
      maybeSingle: async () => ({ data: row, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: matches ? [{ id }] : [], error: null }).then(resolve),
    };
    return query;
  });
}
beforeEach(() => vi.clearAllMocks());

describe("guardado compatible y sin sobrescrituras silenciosas", () => {
  it("una pestaña antigua no degrada un perfil V2 a V1", async () => {
    setup(2);
    const data = input(); data.functional_profile.schema_version = 1;
    expect(await updateProfile(ws, id, data)).toEqual({ ok: false, reason: "conflict" });
    expect(fakes.writes).not.toHaveBeenCalled();
  });
  it("una revisión de formulario obsoleta se rechaza antes de escribir", async () => {
    setup(2);
    expect(await updateProfile(ws, id, { ...input(), expected_updated_at: "2026-10-25T10:00:00.000Z" })).toEqual({ ok: false, reason: "conflict" });
    expect(fakes.writes).not.toHaveBeenCalled();
  });
  it("permite editar V1 con un filtro atómico por timestamp y workspace", async () => {
    setup(1);
    const data = input(); data.functional_profile.schema_version = 1;
    expect(await updateProfile(ws, id, data)).toEqual({ ok: true, id });
    expect(fakes.filters).toHaveBeenCalledWith("updated_at", timestamp);
    expect(fakes.filters).toHaveBeenCalledWith("workspace_id", ws);
  });
  it("un cambio concurrente durante la escritura no se presenta como guardado", async () => {
    setup(2, false);
    expect(await updateProfile(ws, id, { ...input(), expected_updated_at: timestamp })).toEqual({ ok: false, reason: "conflict" });
  });
  it("un fallo al leer la revisión devuelve un error seguro y no escribe", async () => {
    fakes.from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: { message: "detalle interno" } }) }) }) }) }) });
    expect(await updateProfile(ws, id, input())).toEqual({ ok: false, reason: "error" });
    expect(fakes.writes).not.toHaveBeenCalled();
  });
});
