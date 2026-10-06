import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Privacidad" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidad">
      <p>
        Esta página resume cómo está diseñado Adaptaula para minimizar los datos. El texto legal definitivo (responsable,
        base jurídica, derechos y plazos) está pendiente de redactar y revisar.
      </p>
      <h2>Qué datos tratamos</h2>
      <ul>
        <li>Datos de tu cuenta: email y, si lo indicas, tu nombre.</li>
        <li>Los materiales que subas.</li>
        <li>Los perfiles de alumnado que crees: un alias o iniciales, etapa, curso y las necesidades funcionales que indiques.</li>
      </ul>
      <h2>Qué no pedimos</h2>
      <ul>
        <li>Nombre completo, fecha de nacimiento, DNI, dirección o teléfono del alumnado.</li>
        <li>Fotografías, informes o documentación médica.</li>
      </ul>
      <h2>Qué se envía a la inteligencia artificial</h2>
      <p>
        Solo el material, la etapa, el curso, la asignatura, las necesidades funcionales y tu petición. Nunca el alias ni las notas
        del alumnado.
      </p>
      <h2>Proveedores</h2>
      <p>Pendiente de completar: alojamiento y base de datos, procesamiento de IA, pagos y correo electrónico.</p>
    </LegalPage>
  );
}
