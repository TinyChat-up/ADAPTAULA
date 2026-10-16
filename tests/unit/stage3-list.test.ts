import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AdaptationList } from "@/components/adaptation/adaptation-list";
import type { AdaptationListItem } from "@/lib/adaptation/orchestration/page-data";

const base: AdaptationListItem = {
  id: "11111111-1111-4111-8111-111111111111", materialId: "22222222-2222-4222-8222-222222222222",
  materialTitle: "Ficha sintética", profileName: "Perfil sintético", createdAt: "2026-10-16T12:00:00Z", updatedAt: "2026-10-16T12:10:00Z",
  state: { label: "Ficha preparada", group: "done", cta: "Ver ficha" },
};

describe("acciones del historial", () => {
  it("muestra original, comparador y PDF de la generada sin ofrecer edición al lector", () => {
    const html = renderToStaticMarkup(createElement(AdaptationList, { items: [base], history: true }));
    expect(html).toContain(`/app/materiales/${base.materialId}`);
    expect(html).toContain(`/app/adaptaciones/${base.id}/comparar`);
    expect(html).toContain("Adaptación generada");
    expect(html).toContain("Descargar PDF");
    expect(html).not.toContain(`/app/adaptaciones/${base.id}/editar`);
  });
  it("ofrece edición solo al escritor y no anuncia PDF para una ficha pendiente", () => {
    const writer = renderToStaticMarkup(createElement(AdaptationList, { items: [base], history: true, canWrite: true }));
    expect(writer).toContain(`/app/adaptaciones/${base.id}/editar`);
    const attention = { ...base, state: { label: "Necesita una revisión", group: "attention" as const, cta: "Revisar" } };
    const pending = renderToStaticMarkup(createElement(AdaptationList, { items: [attention], history: true, canWrite: true }));
    expect(pending).not.toContain("Descargar PDF");
    expect(pending).not.toContain(`/app/adaptaciones/${base.id}/comparar`);
    expect(pending).toContain(`/app/adaptaciones/${base.id}`);
  });
});
