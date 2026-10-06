import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-10 sm:py-16">
      <Logo />
      <main id="contenido" className="mt-8 w-full max-w-md">
        <div className="rounded-card border border-border bg-surface p-6 shadow-card sm:p-8">{children}</div>
      </main>
    </div>
  );
}
