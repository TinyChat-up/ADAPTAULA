import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Cookies" };

export default function CookiesPage() {
  return (
    <LegalPage title="Política de cookies">
      <p>El texto legal definitivo está pendiente de revisión. Este es el uso previsto actualmente:</p>
      <h2>Cookies estrictamente necesarias</h2>
      <ul>
        <li>Sesión de acceso (para mantenerte identificado).</li>
        <li>Espacio de trabajo activo.</li>
        <li>Preferencias básicas de la interfaz.</li>
      </ul>
      <h2>Analítica</h2>
      <p>
        La medición de uso se plantea sin cookies y sin identificar al alumnado. Si en el futuro se añade una herramienta que use
        cookies no necesarias, se pedirá tu consentimiento antes.
      </p>
    </LegalPage>
  );
}
