import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileSummaryPanel } from "@/components/profiles/profile-summary-panel";
import { summarizeProfile } from "@/lib/profiles/summary";
import { emptyFunctionalProfile, type FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { PedagogicalProfile } from "@/lib/schemas/pedagogical-profile";

const subjects = [
  { slug: "matematicas", name: "Matemáticas" },
  { slug: "lengua", name: "Lengua" },
];

function render(areas: PedagogicalProfile["areas"]) {
  const profile: FunctionalProfile = {
    ...emptyFunctionalProfile(),
    schema_version: 3,
    pedagogy: { areas, response_preferences: [], adaptation_preferences: [] },
  };
  const summary = summarizeProfile(profile);
  return { html: renderToStaticMarkup(createElement(ProfileSummaryPanel, { summary, learning: { areas, subjects } })), summary };
}

describe("aprendizajes en el resumen del perfil", () => {
  const mathematics: PedagogicalProfile["areas"][number] = {
    subject: "matematicas",
    reference_grade: null,
    knows: ["Ordena fracciones"],
    abilities: [
      { statement: "Lee gráficos", autonomy: "independent" },
      { statement: "Compara escalas", autonomy: "with_help" },
    ],
    needs: [],
  };
  const language: PedagogicalProfile["areas"][number] = {
    subject: "lengua",
    reference_grade: null,
    knows: [],
    abilities: [{ statement: "Escribe una justificación", autonomy: "not_yet" }],
    needs: [],
  };

  it("muestra los cuatro estados por asignatura sin atribuir autonomía a los aprendizajes históricos", () => {
    const { html, summary } = render([mathematics, language]);
    expect(html).toMatch(/Matemáticas<\/h3>.*Ordena fracciones<span[^>]*>Sin valorar<\/span>.*Lee gráficos<span[^>]*>Lo hace solo<\/span>.*Compara escalas<span[^>]*>Lo consigue con ayuda<\/span>.*Lengua<\/h3>.*Escribe una justificación<span[^>]*>Todavía no lo consigue<\/span>/);
    expect(html).not.toContain("<details");
    expect(JSON.stringify(summary)).not.toContain("Ordena fracciones");
  });

  it("agrupa una lista larga en un desplegable y separa lo que queda por reforzar", () => {
    const { html } = render([mathematics, { ...language, needs: ["Argumentar con ejemplos", " "] }]);
    expect(html).toMatch(/<details class="text-sm"><summary[^>]*>Ver todos los aprendizajes \(5\)<\/summary>.*Matemáticas<\/h3>.*Lengua<\/h3>.*Por reforzar<\/p>.*<li>Argumentar con ejemplos<\/li>.*<\/details>/);
  });
});
