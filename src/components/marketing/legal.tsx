import type { ReactNode } from "react";
import { Alert } from "@/components/ui/feedback";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-14 sm:px-6 sm:py-20">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <Alert tone="warning" title="Borrador pendiente de revisión jurídica">
        Este texto es un marcador de posición. No es un documento legal definitivo y no debe interpretarse como tal. Se sustituirá
        por la versión revisada por un profesional antes del lanzamiento comercial.
      </Alert>
      <div className="space-y-6 text-foreground/90 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:leading-7">
        {children}
      </div>
    </div>
  );
}
