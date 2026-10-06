import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Términos" };

export default function TermsPage() {
  return (
    <LegalPage title="Términos de uso">
      <p>Los términos de uso definitivos están pendientes de redactar y revisar. Mientras tanto, estos son los principios del producto:</p>
      <ul>
        <li>Adaptaula genera propuestas editables. No diagnostica ni evalúa y no sustituye al orientador ni a otros profesionales.</li>
        <li>El docente es responsable de revisar el material antes de usarlo con su alumnado.</li>
        <li>Debes tener derecho a utilizar los materiales que subes.</li>
        <li>Se recomienda no incluir información personal innecesaria en los materiales.</li>
      </ul>
      <h2>Condiciones de pago, cancelación y garantías</h2>
      <p>Pendiente de redactar.</p>
    </LegalPage>
  );
}
