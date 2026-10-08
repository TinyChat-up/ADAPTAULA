import { describe, expect, it } from "vitest";
import { listHref, listState } from "@/lib/adaptation/presentation/list";

const STATUSES = ["queued", "planning", "awaiting_plan_review", "generation_queued", "generating", "reviewing_deterministic", "reviewing_ai", "ready", "blocked", "failed", "cancelled"];

describe("adaptation list state", () => {
  it("a stage waiting for the teacher's decision is never shown as in progress (human gates)", () => {
    expect(listState("queued", false)).toMatchObject({ group: "attention", label: "Pendiente de empezar", cta: "Empezar" });
    expect(listState("generation_queued", false)).toMatchObject({ group: "attention", label: "Lista para crear la ficha", cta: "Crear ficha" });
    expect(listState("awaiting_plan_review", false)).toMatchObject({ group: "attention", cta: "Revisar adaptación" });
    // «Hacer magia» with its plan not reviewed yet: the server is continuing it, nobody is waiting for the teacher.
    expect(listState("awaiting_plan_review", false, true)).toMatchObject({ group: "working", label: "Preparando la adaptación", cta: "Ver progreso" });
  });

  it("the same states with a running stage are in progress", () => {
    expect(listState("queued", true).group).toBe("working");
    expect(listState("generation_queued", true).group).toBe("working");
    for (const s of ["planning", "generating", "reviewing_deterministic", "reviewing_ai"]) expect(listState(s, false).group, s).toBe("working");
  });

  it("finished, failed, blocked and cancelled", () => {
    expect(listState("ready", false)).toMatchObject({ group: "done", cta: "Ver ficha" });
    expect(listState("failed", false).group).toBe("attention");
    expect(listState("blocked", false).group).toBe("attention");
    expect(listState("cancelled", false).group).toBe("closed");
  });

  it("product language only: no internal status, job, attempt or provider word; unknown → neutral", () => {
    for (const s of STATUSES) for (const running of [true, false]) {
      const { label, cta } = listState(s, running);
      expect(`${label} ${cta}`).not.toMatch(/queued|planning|generation|review_|job|lease|attempt|intento|proveedor|provider|modelo|error \d/i);
    }
    expect(listState("something_new", false)).toEqual({ label: "En curso", group: "working", cta: "Abrir" });
  });

  it("a ready adaptation leads to its sheet; anything else to its own page", () => {
    expect(listHref("a", listState("ready", false))).toBe("/app/adaptaciones/a/vista");
    expect(listHref("a", listState("awaiting_plan_review", false))).toBe("/app/adaptaciones/a");
  });
});
