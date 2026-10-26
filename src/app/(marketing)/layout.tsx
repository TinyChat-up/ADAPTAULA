import type { ReactNode } from "react";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { getUser } from "@/lib/auth/session";

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  // A signed-in teacher reading the public pages must not look signed out (the proxy does not run here, so this only reads).
  const signedIn = Boolean(await getUser().catch(() => null));
  return (
    <>
      <MarketingHeader signedIn={signedIn} />
      <main id="contenido" className="flex-1">
        {children}
      </main>
      <MarketingFooter />
    </>
  );
}
