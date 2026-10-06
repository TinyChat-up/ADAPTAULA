import type { Metadata } from "next";
import { PricingGrid } from "@/components/marketing/pricing";
import { getPublicPlans } from "@/lib/plans/public-plans";

export const revalidate = 3600;
export const metadata: Metadata = { title: "Precios", description: "Planes de Adaptaula. Empieza gratis." };

export default async function PricingPage() {
  const plans = await getPublicPlans();
  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-14 sm:px-6 sm:py-20">
      <div className="max-w-2xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Precios</h1>
        <p className="text-lg text-muted-foreground">
          Empieza gratis y cambia de plan cuando lo necesites. Precios con IVA incluido, pendientes de validación fiscal antes del
          lanzamiento.
        </p>
      </div>
      <PricingGrid plans={plans} />
    </div>
  );
}
