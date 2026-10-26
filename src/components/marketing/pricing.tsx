import { Check } from "lucide-react";
import { MaxCheckoutButton } from "@/components/account/max-checkout-button";
import type { MaxOffer } from "@/lib/billing/max";
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

function PlanCard({ plan, highlighted, offer }: { plan: PublicPlan; highlighted: boolean; offer: MaxOffer }) {
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
        {free ? <LinkButton href="/registro" variant="primary" className="w-full">Empezar gratis</LinkButton> : <PaidAction offer={offer} max={plan.slug === "max"} />}
      </div>
    </div>
  );
}

const NOTE: Record<MaxOffer, string> = {
  unavailable: "Todavía no se puede contratar este plan.",
  sign_in: "Pago con Stripe en modo prueba: no se cobra nada.",
  buy: "Pago con Stripe en modo prueba: no se cobra nada.",
  current: "Es el plan de tu espacio.",
  not_allowed: "Lo contrata quien administra tu espacio de trabajo.",
};

/** Pro is not sold yet; Max is when `offer` (resolved on the server by maxOffer) allows it. */
function PaidAction({ offer, max }: { offer: MaxOffer; max: boolean }) {
  return (
    <>
      {offer === "buy" ? <MaxCheckoutButton className="w-full" /> : offer === "sign_in" ? (
        <LinkButton href="/login?next=/precios" variant="primary" className="w-full">Entrar para contratar Max</LinkButton>
      ) : (
        <div className="rounded-control border border-border bg-muted px-4 py-3 text-center text-sm font-medium">
          {offer === "current" ? "Tu plan actual" : offer === "unavailable" ? (max ? "En preparación" : "Contratación no disponible") : "Plan Max"}
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground">{NOTE[offer]}</p>
    </>
  );
}

export function PricingGrid({ plans, maxOffer = "unavailable" }: { plans: PublicPlan[]; maxOffer?: MaxOffer }) {
  if (plans.length === 0) {
    return <Alert tone="warning" title="No hemos podido cargar los planes">Vuelve a intentarlo en unos minutos.</Alert>;
  }
  return (
    <div className="space-y-4">
      <div className={cn("grid gap-6", plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
        {plans.map((p) => (
          <PlanCard key={p.slug} plan={p} highlighted={p.slug === "pro"} offer={p.slug === "max" ? maxOffer : "unavailable"} />
        ))}
      </div>
      {/* The numbers are read from the plans table; they are launch values, not a final commercial commitment (docs/PRODUCT.md). */}
      <p className="text-center text-sm text-muted-foreground">Precios provisionales, IVA incluido. Pendientes de validar costes y demanda.</p>
      <p className="text-center text-sm text-muted-foreground">Las clases, los recursos visuales generados y adaptar para varios perfiles a la vez todavía no están disponibles y no forman parte de ningún plan.</p>
    </div>
  );
}

export function PricingSection({ plans, maxOffer }: { plans: PublicPlan[]; maxOffer?: MaxOffer }) {
  return (
    <Section id="precios" title="Precios" intro="Empieza con Free. Consulta la capacidad prevista de los próximos planes." tone="surface">
      <PricingGrid plans={plans} maxOffer={maxOffer} />
    </Section>
  );
}
