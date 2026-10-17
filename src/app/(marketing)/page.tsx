import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks, PrivacySection } from "@/components/marketing/info-sections";
import { PricingSection } from "@/components/marketing/pricing";
import { getPublicPlans } from "@/lib/plans/public-plans";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const plans = await getPublicPlans();
  return (
    <>
      <Hero />
      <HowItWorks />
      <PrivacySection />
      <PricingSection plans={plans} />
      <Faq />
      <FinalCta />
    </>
  );
}
