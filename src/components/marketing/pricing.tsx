import { Check } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { formatEuros } from "@/lib/format/date";
import type { PublicPlan } from "@/lib/schemas/plan";
import { cn } from "@/lib/utils/cn";
import { Section } from "./section";

/** Everything shown comes from the `plans` row: changing a limit in the database changes this page. */
export function planBullets(plan: PublicPlan): string[] {
  const out = [`${plan.monthly_adaptations} adaptaciones al mes`, `Hasta ${plan.max_profiles} perfiles guardados`];
  if (plan.max_classes > 0) out.push(`Hasta ${plan.max_classes} clases`);
  else out.push("Sin clases");
  if (plan.features.multi_profile) out.push("Varios perfiles a la vez");
  if (plan.monthly_images > 0) out.push(`${plan.monthly_images} recursos visuales al mes`);
  if (plan.features.history_days) out.push(`Historial de ${plan.features.history_days} días`);
  else if (plan.features.history_days === null) out.push("Historial completo");
  return out;
}

function PlanCard({ plan, highlighted }: { plan: PublicPlan; highlighted: boolean }) {
  const free = plan.monthly_price_cents === 0;
  return (
    <div className={cn("flex flex-col rounded-card border bg-surface p-6 shadow-card", highlighted ? "border-primary ring-1 ring-primary" : "border-border")}>
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">{plan.name}</h3>
        {highlighted ? <Badge tone="accent">Recomendado</Badge> : null}
      </div>
      <p className="mt-4 text-3xl font-semibold">
        {free ? "Gratis" : formatEuros(plan.monthly_price_cents)}
        {free ? null : <span className="text-base font-normal text-muted-foreground"> /mes</span>}
      </p>
      <p className="mt-1 min-h-5 text-sm text-muted-foreground">
        {free ? "Para probar con tus fichas." : `o ${formatEuros(plan.annual_price_cents)} al año`}
      </p>
      <ul className="mt-6 flex-1 space-y-2">
        {planBullets(plan).map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
            {b}
          </li>
        ))}
      </ul>
      <div className="mt-6 space-y-2">
        <LinkButton href="/registro" variant={highlighted ? "primary" : "secondary"} className="w-full">
          Empezar gratis
        </LinkButton>
        {free ? null : <p className="text-center text-xs text-muted-foreground">La suscripción de pago se activará próximamente.</p>}
      </div>
    </div>
  );
}

export function PricingGrid({ plans }: { plans: PublicPlan[] }) {
  if (plans.length === 0) {
    return <Alert tone="warning" title="No hemos podido cargar los planes">Vuelve a intentarlo en unos minutos.</Alert>;
  }
  return (
    <div className="space-y-4">
      <div className={cn("grid gap-6", plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
        {plans.map((p) => (
          <PlanCard key={p.slug} plan={p} highlighted={p.slug === "pro"} />
        ))}
      </div>
      {/* The numbers are read from the plans table; they are launch values, not a final commercial commitment (docs/PRODUCT.md). */}
      <p className="text-center text-sm text-muted-foreground">Precios y límites de lanzamiento: pueden ajustarse antes de que se activen los planes de pago.</p>
    </div>
  );
}

export function PricingSection({ plans }: { plans: PublicPlan[] }) {
  return (
    <Section id="precios" title="Precios" intro="Empieza gratis y cambia de plan cuando lo necesites. Precios con IVA incluido." tone="surface">
      <PricingGrid plans={plans} />
    </Section>
  );
}
