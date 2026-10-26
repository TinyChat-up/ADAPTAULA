import { Check } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { formatEuros } from "@/lib/format/date";
import type { PublicPlan } from "@/lib/schemas/plan";
import { cn } from "@/lib/utils/cn";
import { Section } from "./section";

/**
 * Only differences that exist and are enforced today, read from the `plans` row (changing a limit in the database changes this
 * page): adaptations, analyses, saved profiles and pages per material. Plan options that are not built yet (classes, images,
 * several profiles per sheet, history length, priority, premium quality, block revisions, editor, comparison) are never sold
 * here, even if the row already carries them (tests/unit/pricing-truth.test.ts).
 */
export function planBullets(plan: PublicPlan): string[] {
  const out = [`${plan.monthly_adaptations} ${plan.monthly_adaptations === 1 ? "adaptación" : "adaptaciones"} al mes`];
  if (plan.features.monthly_analyses !== undefined) out.push(`${plan.features.monthly_analyses} análisis de materiales al mes`);
  out.push(`Hasta ${plan.max_profiles} perfiles guardados`);
  if (plan.features.max_pages_per_material !== undefined) out.push(`Materiales de hasta ${plan.features.max_pages_per_material} páginas`);
  out.push("Descarga en PDF");
  return out;
}

function PlanCard({ plan, highlighted, pilot }: { plan: PublicPlan; highlighted: boolean; pilot: boolean }) {
  const free = plan.monthly_price_cents === 0;
  return (
    <div className={cn("flex min-w-0 flex-col rounded-card border bg-surface p-5 [overflow-wrap:anywhere] sm:p-7", highlighted ? "border-primary/40" : "border-border")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-semibold">{plan.name}</h3>
        {highlighted ? <Badge tone="accent">Próximamente</Badge> : null}
      </div>
      <p className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
        {formatEuros(plan.monthly_price_cents)}
        {free ? null : <span className="text-base font-normal text-muted-foreground"> /mes</span>}
      </p>
      <p className="mt-1 min-h-5 text-sm text-muted-foreground">
        {free ? "Para empezar con tus materiales." : "Al mes, IVA incluido."}
      </p>
      <ul className="mt-6 flex-1 space-y-2">
        {planBullets(plan).map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
            <span className="min-w-0">{b}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6 space-y-2">
        {free ? <LinkButton href="/registro" variant="primary" className="w-full">Empezar gratis</LinkButton> : pilot ? (
          <LinkButton href="/app/uso#piloto-privado" variant="primary" className="w-full">Probar Max</LinkButton>
        ) : (
          <div className="rounded-control border border-border bg-muted px-4 py-3 text-center text-sm font-medium">
            {plan.slug === "max" ? "En preparación" : "Contratación no disponible"}
          </div>
        )}
        {!free && (
          <p className="text-center text-xs text-muted-foreground">
            {pilot ? "Prueba privada de tu cuenta, con Stripe en modo prueba." : "Todavía no se puede contratar este plan."}
          </p>
        )}
      </div>
    </div>
  );
}

/** `pilotMax` is resolved on the server (pilotOfferAvailable); it only links to the private checkout, never sells Max publicly. */
export function PricingGrid({ plans, pilotMax = false }: { plans: PublicPlan[]; pilotMax?: boolean }) {
  if (plans.length === 0) {
    return <Alert tone="warning" title="No hemos podido cargar los planes">Vuelve a intentarlo en unos minutos.</Alert>;
  }
  return (
    <div className="space-y-4">
      <div className={cn("grid gap-6", plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
        {plans.map((p) => (
          <PlanCard key={p.slug} plan={p} highlighted={p.slug === "pro"} pilot={pilotMax && p.slug === "max"} />
        ))}
      </div>
      {/* The numbers are read from the plans table; they are launch values, not a final commercial commitment (docs/PRODUCT.md). */}
      <p className="text-center text-sm text-muted-foreground">Precios provisionales, IVA incluido. Pendientes de validar costes y demanda.</p>
      <p className="text-center text-sm text-muted-foreground">Las clases, los recursos visuales generados y adaptar para varios perfiles a la vez todavía no están disponibles y no forman parte de ningún plan.</p>
    </div>
  );
}

export function PricingSection({ plans, pilotMax = false }: { plans: PublicPlan[]; pilotMax?: boolean }) {
  return (
    <Section id="precios" title="Precios" intro="Empieza con Free. Consulta la capacidad prevista de los próximos planes." tone="surface">
      <PricingGrid plans={plans} pilotMax={pilotMax} />
    </Section>
  );
}
