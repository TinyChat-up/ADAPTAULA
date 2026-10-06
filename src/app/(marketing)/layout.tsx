import type { ReactNode } from "react";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MarketingHeader />
      <main id="contenido" className="flex-1">
        {children}
      </main>
      <MarketingFooter />
    </>
  );
}
