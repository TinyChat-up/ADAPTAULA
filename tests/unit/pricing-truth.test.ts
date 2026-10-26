import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PricingGrid, planBullets } from "@/components/marketing/pricing";
import { STEPS } from "@/components/marketing/steps";
import { PublicPlanSchema, type PublicPlan } from "@/lib/schemas/plan";

/**
 * /precios sells only what exists and is enforced. The plans are read from the seed itself (the single source of the limits),
 * WITH every not-yet-built option they carry (images, classes, several profiles, history, priority, premium…): none of it may
 * appear as something the plan includes.
 */

const SEED = readFileSync(path.resolve(import.meta.dirname, "../../supabase/seed.sql"), "utf8");
function seededPlans(): PublicPlan[] {
  const rows = [...SEED.matchAll(/\('(free|pro|max)', '(\w+)', (\d+), (\d+), (\d+), (\d+), (\d+), (\d+), '(\{[\s\S]*?\})'::jsonb, (\d+)\)/g)];
  return rows.map((m) =>
    PublicPlanSchema.parse({
      slug: m[1], name: m[2], monthly_price_cents: Number(m[3]), annual_price_cents: Number(m[4]), monthly_adaptations: Number(m[5]), monthly_images: Number(m[6]),
      max_profiles: Number(m[7]), max_classes: Number(m[8]), features: JSON.parse(m[9]!), sort_order: Number(m[10]),
    }),
  );
}

const NOT_BUILT = /clase|recurso|imagen|imágen|visual|varios perfiles|a la vez|historial|prioridad|prioritari|premium|regenera|bloque|editor|comparador|plantilla|ilimitad/i;

describe("/precios tells the truth", () => {
  it("reads the three seeded plans, including the options that are not built yet", () => {
    const plans = seededPlans();
    expect(plans.map((p) => p.slug)).toEqual(["free", "pro", "max"]);
    expect(plans.find((p) => p.slug === "max")).toMatchObject({ monthly_images: 0, max_classes: 30, features: { multi_profile: true, priority_processing: true } });
  });

  it("each plan lists only real, enforced differences: adaptations, analyses, profiles, pages and the PDF download", () => {
    for (const plan of seededPlans()) {
      const bullets = planBullets(plan);
      for (const b of bullets) expect(b, `${plan.slug}: ${b}`).not.toMatch(NOT_BUILT);
      expect(bullets).toEqual([
        `${plan.monthly_adaptations} ${plan.monthly_adaptations === 1 ? "adaptación" : "adaptaciones"} al mes`,
        `${plan.features.monthly_analyses} análisis de materiales al mes`,
        `Hasta ${plan.max_profiles} perfiles guardados`,
        `Materiales de hasta ${plan.features.max_pages_per_material} páginas`,
        "Descarga en PDF",
      ]);
    }
  });

  it("the page says the numbers are launch values and that classes, generated visuals and several profiles at once are not available", () => {
    const html = renderToStaticMarkup(createElement(PricingGrid, { plans: seededPlans() }));
    expect(html).toContain("Precios provisionales, IVA incluido.");
    expect(html).toContain("En preparación");
    expect(html).toContain("Contratación no disponible");
    expect(html.match(/href="\/registro"/g)).toHaveLength(1);
    expect(html).not.toContain("al año");
    expect(html).toContain("todavía no están disponibles y no forman parte de ningún plan");
    expect(html).not.toMatch(/50 recursos visuales|Hasta 30 clases|Hasta 10 clases|Varios perfiles a la vez|Historial completo|Historial de 30 días/);
  });

  it("Max offers its Stripe test checkout when the server allows it; Pro stays unavailable and the note says nothing is charged", () => {
    const render = (maxOffer: "unavailable" | "sign_in" | "buy" | "current" | "not_allowed") =>
      renderToStaticMarkup(createElement(PricingGrid, { plans: seededPlans(), maxOffer }));
    const buy = render("buy");
    expect(buy).toContain("Contratar Max");
    expect(buy).toContain("modo prueba: no se cobra nada");
    expect(buy).not.toContain("En preparación");
    expect(buy).toContain("Contratación no disponible");
    expect(render("sign_in")).toContain('href="/login?next=/precios"');
    expect(render("current")).toContain("Tu plan actual");
    expect(render("not_allowed")).not.toContain("Contratar Max");
    expect(render("unavailable")).not.toMatch(/Contratar Max|modo prueba/);
  });

  it("'Cómo funciona' does not promise a quick adaptation without a profile nor a free-text request", () => {
    const text = STEPS.map((s) => s.text).join(" ");
    expect(text).not.toMatch(/adaptación rápida|Indica qué quieres adaptar/);
  });
});
