import { beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ authenticated: true, role: "teacher" }));
const exportPdf = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/context", async () => ({ ...(await vi.importActual("@/lib/api/context")), getApiContext: async () => session.authenticated ? { ctx: { user: { id: "user" }, workspace: { id: "workspace" }, role: session.role } } : { response: new Response(null, { status: 401 }) } }));
vi.mock("@/lib/auth/session", () => ({ getSupabase: async () => ({}) }));
vi.mock("@/lib/adaptation/orchestration/server", () => ({ serviceDeps: () => ({}) }));
vi.mock("@/lib/materials/visuals/server", () => ({ visualDeps: () => ({}) }));
vi.mock("@/lib/adaptation/resources/server", () => ({ resourceDeps: () => ({}) }));
vi.mock("@/lib/render/generated", () => ({ generatedDeps: () => ({}) }));
vi.mock("@/lib/editor/store", () => ({ draftStore: () => ({}) }));
vi.mock("@/lib/render/print/server", () => ({ pdfEngine: () => ({}) }));
vi.mock("@/lib/render/pdf-export", () => ({ exportAdaptationPdf: exportPdf }));
const { GET } = await import("@/app/api/adaptations/[id]/pdf/route");
const id = "5a432569-5b0c-471d-8ef8-04393b18a937";
const get = (query = "") => GET(new Request(`http://localhost/api/adaptations/${id}/pdf${query}`), { params: Promise.resolve({ id }) } as never);
const pdf = new TextEncoder().encode("%PDF-1.7\nvalidated by service\n%%EOF\n");
beforeEach(() => { session.authenticated = true; session.role = "teacher"; exportPdf.mockReset().mockResolvedValue({ ok: true, pdf, pageCount: 11, contentDisposition: 'attachment; filename="Ficha.pdf"' }); });

it("returns validated service metadata with the exact bytes and private headers, also for a reader", async () => {
  session.role = "viewer";
  const res = await get("?borrador=3&version=1");
  expect(res.status).toBe(200);
  expect(res.headers.get("X-PDF-Page-Count")).toBe("11");
  expect(res.headers.get("X-PDF-Byte-Length")).toBe(String(pdf.length));
  expect(res.headers.get("X-PDF-Revision")).toBe("draft:3");
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(res.headers.get("Vary")).toBe("Cookie");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdf);
  expect(exportPdf.mock.calls[0]!.slice(1)).toEqual([{ userId: "user", workspaceId: "workspace", canWrite: false }, id, 3, 1]);
});
it("distinguishes the generated sheet and refuses anonymous or invalid revision requests before rendering", async () => {
  expect((await get()).headers.get("X-PDF-Revision")).toBe("generated");
  exportPdf.mockClear();
  expect((await get("?borrador=0")).status).toBe(404);
  expect((await get("?version=-1")).status).toBe(404);
  session.authenticated = false;
  expect((await get()).status).toBe(401);
  expect(exportPdf).not.toHaveBeenCalled();
});
it("keeps existing controlled failures without PDF success metadata", async () => {
  for (const [code, status] of [["not_found", 404], ["resource_pending", 409], ["not_ready", 409], ["not_renderable", 409], ["render_failed", 503], ["version_changed", 409]] as const) {
    exportPdf.mockResolvedValue({ ok: false, code });
    const res = await get();
    expect(res.status).toBe(status);
    expect(res.headers.has("X-PDF-Page-Count")).toBe(false);
    expect(await res.json()).toMatchObject({ error: { code } });
  }
});
