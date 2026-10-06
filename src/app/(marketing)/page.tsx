import { Demo } from "@/components/marketing/demo";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { AdaptationTypes, HowItWorks, Needs, PrivacySection, Stages } from "@/components/marketing/info-sections";
import { PricingSection } from "@/components/marketing/pricing";
import { getPublicPlans } from "@/lib/plans/public-plans";

export const revalidate = 3600;

export default async function LandingPage() {
  const plans = await getPublicPlans();
  return (
    <>
      <Hero />
      <Demo />
      <HowItWorks />
      <AdaptationTypes />
      <Stages />
      <Needs />
      <PrivacySection />
      <PricingSection plans={plans} />
      <Faq />
      <FinalCta />
    </>
  );
}
