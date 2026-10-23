import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/app/onboarding-wizard";
import { Logo } from "@/components/ui/logo";
import { requireWorkspace } from "@/lib/auth/workspace";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { completeOnboarding } from "./actions";

export const metadata: Metadata = { title: "Bienvenida" };

export default async function WelcomePage() {
  const ctx = await requireWorkspace();
  if (ctx.profile.onboardingCompleted) redirect("/app");
  const usage = await getWorkspaceUsage(ctx.workspace.id);
  return (
    <div className="bg-background flex min-h-screen flex-col items-center px-4 py-10 sm:py-16">
      <Logo href="/app" size="lg" />
      <main id="contenido" className="mt-8 w-full max-w-2xl">
        <div className="border-t-2 border-foreground bg-surface p-6 sm:p-8">
          <OnboardingWizard action={completeOnboarding} plan={{ name: usage.plan.name, adaptations: usage.adaptations.limit, analyses: usage.analyses.limit, profiles: usage.max_profiles }} />
        </div>
      </main>
    </div>
  );
}
