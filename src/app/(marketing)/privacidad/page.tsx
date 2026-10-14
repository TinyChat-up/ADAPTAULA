import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Privacidad" };

// Draft: every [Pendiente] is a fact that legal review must supply; never fill it with an assumption.
export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidad">
      <p>
        Esta política explica qué datos trata Adaptaula, para qué y con qué límites. Los apartados marcados como «pendiente» se
        completarán tras la revisión jurídica.
      </p>

      <h2>Responsable</h2>
      <p>Pendiente: identidad del responsable, dirección y correo de contacto para privacidad.</p>

      <h2>Qué datos tratamos</h2>
      <ul>
        <li>Tu cuenta: correo electrónico y, si lo indicas, tu nombre.</li>
        <li>Los materiales que subes y las adaptaciones que generas.</li>
        <li>Los perfiles de alumnado que creas: un alias o iniciales, etapa, curso y necesidades funcionales. No pedimos diagnósticos.</li>
        <li>Datos técnicos de cada proceso (fecha, duración, resultado y coste), sin el contenido del material ni datos del alumnado.</li>
      </ul>
      <p>
        No pedimos nombre completo, fecha de nacimiento, DNI, dirección, teléfono, fotografías ni documentación médica del alumnado.
        Te pedimos que no subas materiales con datos personales innecesarios: nombres, respuestas, notas o fotografías de alumnos.
        Ten en cuenta que los ficheros pueden llevar datos ocultos (autor, dispositivo, ubicación); hoy se guardan tal como los subes.
      </p>

      <h2>Para qué los usamos</h2>
      <p>
        <strong>Para prestarte el servicio:</strong> analizar y adaptar las fichas que nos pides y guardarlas en tu espacio de
        trabajo hasta que las borres. Es la única finalidad para la que usamos tus materiales. Base jurídica: pendiente de revisión.
      </p>
      <p>
        <strong>No usamos tus materiales para mejorar Adaptaula ni para entrenar modelos.</strong> Aceptar estas condiciones o subir
        un fichero no lo autoriza. Mejoramos el servicio con fichas creadas por nuestro equipo. Si en el futuro ofrecemos que
        aportes una ficha de forma voluntaria, será mediante una autorización aparte, desactivada por defecto, para cada ficha y
        con su finalidad explicada. Podrás retirarla, y no será necesaria para usar el servicio. Esa opción no existe todavía.
      </p>

      <h2>Qué se envía a la inteligencia artificial</h2>
      <p>
        Para analizar una ficha se envía el fichero (o imágenes de sus páginas), junto con el contexto educativo que confirmes: etapa, curso, asignatura y tema. Para adaptarla se
        envían el contenido analizado, las necesidades funcionales del perfil y tu petición. Nunca enviamos el alias del alumno ni
        tu identidad. Para generar ilustraciones solo se envía una descripción del dibujo, nunca el material.
      </p>

      <h2>Proveedores</h2>
      <ul>
        <li>Supabase: base de datos, acceso y almacenamiento privado.</li>
        <li>Vercel: alojamiento y ejecución.</li>
        <li>Anthropic: procesamiento de texto y documentos con IA.</li>
        <li>OpenAI: generación de ilustraciones.</li>
        <li>Stripe: pagos, cuando se activen.</li>
      </ul>
      <p>
        Pendiente: contratos de encargo, regiones de tratamiento, transferencias internacionales y garantías, y condiciones de
        conservación de cada proveedor. Solo indicaremos lo que esté comprobado en esos contratos y configuraciones.
      </p>

      <h2>Cuánto tiempo los conservamos</h2>
      <p>
        Tus materiales y adaptaciones se conservan hasta que los borres. Hoy puedes borrar materiales que no tengan adaptaciones.
        Pendiente: plazos para registros técnicos y cuentas eliminadas, y la forma de solicitar el borrado completo de la cuenta.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Puedes solicitar acceso, rectificación, supresión, oposición, limitación y portabilidad, y reclamar ante la Agencia Española
        de Protección de Datos. Pendiente: canal para ejercerlos.
      </p>

      <h2>Centros educativos</h2>
      <p>
        Cuando un centro contrate Adaptaula para su profesorado, el centro decidirá sobre los datos de su alumnado y Adaptaula
        actuará siguiendo sus instrucciones, con un contrato de encargo. Cualquier otro uso requeriría un acuerdo específico.
      </p>
    </LegalPage>
  );
}
