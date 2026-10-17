import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), update: vi.fn(), eq: vi.fn(), row: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: mocks.user,
  getSupabase: async () => ({ from: (table: string) => {
    expect(table).toBe("profiles");
    return { update: mocks.update };
  } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
const { updateAccountName } = await import("@/app/app/(shell)/uso/actions");
const form = (name: string) => {
  const data = new FormData();
  data.set("full_name", name);
  data.set("id", "otra-cuenta");
  data.set("onboarding_completed", "false");
  return data;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "cuenta-autenticada" });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ select: () => ({ maybeSingle: mocks.row }) });
  mocks.row.mockResolvedValue({ data: { id: "cuenta-autenticada" }, error: null });
});
it("solo cambia el nombre de la sesión y revalida el saludo; ignora ids y columnas añadidos", async () => {
  expect((await updateAccountName({ status: "idle" }, form("  Docente sintética  "))).status).toBe("success");
  expect(mocks.update).toHaveBeenCalledWith({ full_name: "Docente sintética" });
  expect(mocks.eq).toHaveBeenCalledWith("id", "cuenta-autenticada");
  expect(mocks.revalidate).toHaveBeenCalledWith("/app", "layout");
});
it.each(["  ", "X".repeat(121)])("valida el nombre en servidor antes de escribir (%s)", async (name) => {
  expect((await updateAccountName({ status: "idle" }, form(name))).status).toBe("error");
  expect(mocks.update).not.toHaveBeenCalled();
});
it.each([
  { data: null, error: null },
  { data: null, error: { message: "detalle privado de BD" } },
])("no anuncia guardado sin fila confirmada ni expone errores internos", async (response) => {
  mocks.row.mockResolvedValue(response);
  const result = await updateAccountName({ status: "idle" }, form("Docente"));
  expect(result.status).toBe("error");
  expect(result.message).not.toContain("privado");
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("exige autenticación incluso si se invoca la acción directamente", async () => {
  mocks.user.mockRejectedValue(new Error("sesión requerida"));
  await expect(updateAccountName({ status: "idle" }, form("Docente"))).rejects.toThrow("sesión requerida");
  expect(mocks.update).not.toHaveBeenCalled();
});
