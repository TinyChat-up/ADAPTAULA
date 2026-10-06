import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/app/onboarding-wizard";
import { Logo } from "@/components/ui/logo";
import { requireWorkspace } from "@/lib/auth/workspace";
import { completeOnboarding } from "./actions";

export const metadata: Metadata = { title: "Bienvenida" };

export default async function WelcomePage() {
  const ctx = await requireWorkspace();
  if (ctx.profile.onboardingCompleted) redirect("/app");
  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-10 sm:py-16">
      <Logo href="/app" />
      <main id="contenido" className="mt-8 w-full max-w-xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-card sm:p-8">
          <OnboardingWizard action={completeOnboarding} />
        </div>
      </main>
    </div>
  );
}
