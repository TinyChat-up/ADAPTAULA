import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Términos" };

// Draft: every [Pendiente] is a fact that legal review must supply; never fill it with an assumption.
export default function TermsPage() {
  return (
    <LegalPage title="Términos de uso">
      <p>Estos términos regulan el uso de Adaptaula. Los apartados marcados como «pendiente» se completarán tras la revisión jurídica.</p>

      <h2>Titular del servicio</h2>
      <p>Pendiente: identidad, dirección y contacto.</p>

      <h2>Qué es Adaptaula</h2>
      <ul>
        <li>Adaptaula genera propuestas editables de adaptación de materiales a partir de necesidades funcionales de aprendizaje.</li>
        <li>No diagnostica ni evalúa al alumnado y no sustituye al orientador ni a otros profesionales.</li>
        <li>Debes revisar cada propuesta antes de usarla con tu alumnado. La IA puede cometer errores.</li>
      </ul>

      <h2>Tus materiales</h2>
      <ul>
        <li>
          Solo debes subir materiales que tengas derecho a utilizar de este modo: propios, de tu centro con su permiso o con una
          licencia o excepción legal que lo cubra. Pendiente: alcance concreto según la revisión de propiedad intelectual.
        </li>
        <li>
          No subas materiales con datos personales innecesarios del alumnado ni de otras personas: nombres, respuestas, notas,
          fotografías, informes o datos de salud.
        </li>
        <li>
          Usamos tus materiales solo para prestarte el servicio. Aceptar estos términos no autoriza a usarlos para evaluar o
          mejorar Adaptaula ni para entrenar modelos. Esos usos, si se ofrecen algún día, requerirán una autorización aparte,
          voluntaria y revocable, para cada material.
        </li>
        <li>Conservas los derechos que tengas sobre tus materiales.</li>
      </ul>

      <h2>Uso aceptable</h2>
      <ul>
        <li>No intentes acceder a datos de otros espacios de trabajo ni eludir los límites de tu plan.</li>
        <li>No uses el servicio para contenidos ilícitos ni para tratar datos que no estés legitimado a tratar.</li>
      </ul>

      <h2>Condiciones de pago, cancelación y garantías</h2>
      <p>Pendiente de redactar.</p>

      <h2>Responsabilidad, ley aplicable y modificaciones</h2>
      <p>Pendiente de redactar.</p>
    </LegalPage>
  );
}
