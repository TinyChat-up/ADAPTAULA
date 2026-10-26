import type { Metadata } from "next";
import { PricingGrid } from "@/components/marketing/pricing";
import { pilotOfferAvailable } from "@/lib/billing/pilot";
import { getPublicPlans } from "@/lib/plans/public-plans";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Precios", description: "Planes de Adaptaula. Empieza gratis." };

export default async function PricingPage() {
  const [plans, pilotMax] = await Promise.all([getPublicPlans(), pilotOfferAvailable()]);
  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-14 sm:px-6 sm:py-20">
      <div className="max-w-2xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Precios</h1>
        <p className="text-lg text-muted-foreground">
          Una misma herramienta para adaptar, revisar y descargar tus fichas. Empieza con Free; Pro y Max todavía no están disponibles para contratar.
        </p>
      </div>
      <PricingGrid plans={plans} pilotMax={pilotMax} />
    </div>
  );
}
