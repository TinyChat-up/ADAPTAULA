import { beforeEach, expect, it, vi } from "vitest";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const id = "5a432569-5b0c-471d-8ef8-04393b18a937";

const session = vi.hoisted(() => ({ authenticated: true, role: "teacher", workspace: "11111111-1111-4111-8111-111111111111" }));
const env = vi.hoisted(() => ({ list: "11111111-1111-4111-8111-111111111111" as string | undefined }));
const row = vi.hoisted(() => ({ visible: { id: "5a432569-5b0c-471d-8ef8-04393b18a937", workspace_id: "11111111-1111-4111-8111-111111111111" } as { id: string; workspace_id: string } | null }));
// Everything that reads with the server's privileges or builds the sheet. None of it may run for an unauthorised request.
const privileged = vi.hoisted(() => ({ store: vi.fn(() => ({})), download: vi.fn(), sheet: vi.fn(), engine: vi.fn(() => ({})) }));

vi.mock("@/lib/api/context", async () => ({ ...(await vi.importActual("@/lib/api/context")), getApiContext: async () => session.authenticated ? { ctx: { user: { id: "user" }, workspace: { id: session.workspace }, role: session.role } } : { response: new Response(null, { status: 401 }) } }));
vi.mock("@/lib/auth/session", () => ({ getSupabase: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row.visible }) }) }) }) }) }));
vi.mock("@/lib/config/env.server", () => ({ serverEnv: () => ({ DIRECTOR_PREVIEW_WORKSPACES: env.list }) }));
vi.mock("@/lib/adaptation/orchestration/server", () => ({ adaptationStore: privileged.store }));
vi.mock("@/lib/materials/storage", () => ({ downloadSource: privileged.download }));
vi.mock("@/lib/render/print/server", () => ({ pdfEngine: privileged.engine }));
vi.mock("@/lib/adaptation/directed/bridge", () => ({ directedSheet: privileged.sheet }));
const { GET } = await import("@/app/api/adaptations/[id]/director-pdf/route");

const get = (target = id) => GET(new Request(`http://localhost/api/adaptations/${target}/director-pdf`), { params: Promise.resolve({ id: target }) } as never);
const pdf = new TextEncoder().encode("%PDF-1.7\npreview\n%%EOF\n");
const untouched = () => { for (const spy of [privileged.store, privileged.download, privileged.sheet, privileged.engine]) expect(spy).not.toHaveBeenCalled(); };

beforeEach(() => {
  Object.assign(session, { authenticated: true, role: "teacher", workspace: WORKSPACE });
  env.list = WORKSPACE;
  row.visible = { id, workspace_id: WORKSPACE };
  for (const spy of [privileged.store, privileged.download, privileged.sheet, privileged.engine]) spy.mockClear();
  privileged.sheet.mockResolvedValue({ status: "review_pending", pdf, checks: { supports: "complete" }, trace: [] });
});

it.each([
  ["sin sesión", () => { session.authenticated = false; }, 401],
  ["workspace que no está en la lista", () => { env.list = OTHER; }, 404],
  ["lista vacía (por defecto)", () => { env.list = undefined; }, 404],
  ["lista con entradas mal formadas", () => { env.list = `${WORKSPACE.slice(0, 20)},*,todos`; }, 404],
  ["identificador de adaptación no válido", () => {}, 404, "no-es-un-uuid"],
  ["rol de solo lectura", () => { session.role = "viewer"; }, 403],
  ["adaptación que el usuario no puede leer (RLS)", () => { row.visible = null; }, 404],
  ["adaptación de otro workspace", () => { row.visible = { id, workspace_id: OTHER }; }, 404],
] as const)("%s: se rechaza sin lecturas privilegiadas ni fabricación", async (_name, arrange, status, target) => {
  arrange();
  const res = await get(target);
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).not.toBe("application/pdf");
  untouched();
});

it("control positivo: el profesorado de un workspace de la lista recibe el PDF privado y solo entonces se lee con privilegios", async () => {
  const res = await get();
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/pdf");
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdf);
  expect(privileged.sheet).toHaveBeenCalledTimes(1);
  expect(privileged.sheet.mock.calls[0]!.slice(1)).toEqual([WORKSPACE, id]);
});
