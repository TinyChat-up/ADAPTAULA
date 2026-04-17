import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

export default function TermsPage() {
  return (
    <div
      className="min-h-screen px-6 py-16"
      style={{ background: "var(--aa-cream, #FAF7F2)" }}
    >
      <div className="mx-auto max-w-[680px]">
        {/* Back link */}
        <div className="mb-8">
          <Link
            href="/"
            className="text-sm font-medium transition-opacity hover:opacity-70"
            style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
          >
            ← Volver
          </Link>
        </div>

        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <BrandLogo />
        </div>

        {/* Title */}
        <h1
          className="mt-8 mb-2 text-2xl font-bold"
          style={{ color: "var(--aa-text, #2C3B2D)" }}
        >
          Términos y Condiciones
        </h1>
        <p
          className="mb-8 text-sm"
          style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
        >
          Última actualización: abril 2026
        </p>

        {/* Sections */}
        <div className="space-y-8">
          <section>
            <h2
              className="mb-2 text-base font-semibold"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              1. Uso del servicio
            </h2>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
            >
              AdaptAula es una herramienta para docentes que adapta materiales educativos. El uso
              está sujeto a las condiciones descritas en este documento.
            </p>
          </section>

          <section>
            <h2
              className="mb-2 text-base font-semibold"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              2. Suscripción Pro
            </h2>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
            >
              El plan Pro se factura mensualmente. Puedes cancelar en cualquier momento desde tu
              portal de cliente.
            </p>
          </section>

          <section>
            <h2
              className="mb-2 text-base font-semibold"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              3. Propiedad intelectual
            </h2>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
            >
              Los materiales generados son propiedad del docente. AdaptAula no almacena ni
              comparte contenido pedagógico sin consentimiento.
            </p>
          </section>

          <section>
            <h2
              className="mb-2 text-base font-semibold"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              4. Limitación de responsabilidad
            </h2>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
            >
              AdaptAula no garantiza la idoneidad pedagógica de las adaptaciones. El docente es
              responsable de la revisión del material.
            </p>
          </section>

          <section>
            <h2
              className="mb-2 text-base font-semibold"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              5. Contacto
            </h2>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
            >
              Para cualquier consulta:{" "}
              <a
                href="mailto:hola@adaptaula.com"
                className="font-medium underline-offset-2 hover:underline"
                style={{ color: "var(--aa-green-dark, #4A7C59)" }}
              >
                hola@adaptaula.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
