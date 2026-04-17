import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

export default function PrivacyPage() {
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
          Política de Privacidad
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
              1. Datos recopilados
            </h2>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
            >
              Recopilamos email, datos de uso y contenidos pedagógicos procesados para generar
              adaptaciones.
            </p>
          </section>

          <section>
            <h2
              className="mb-2 text-base font-semibold"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              2. Uso de los datos
            </h2>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
            >
              Los datos se usan exclusivamente para prestar el servicio. No vendemos ni
              compartimos datos con terceros.
            </p>
          </section>

          <section>
            <h2
              className="mb-2 text-base font-semibold"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              3. Proveedor de pagos
            </h2>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
            >
              Los pagos son gestionados por Stripe. No almacenamos datos de tarjetas.
            </p>
          </section>

          <section>
            <h2
              className="mb-2 text-base font-semibold"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              4. Retención
            </h2>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
            >
              Los datos se conservan mientras la cuenta esté activa. Puedes solicitar la
              eliminación escribiendo a{" "}
              <a
                href="mailto:hola@adaptaula.com"
                className="font-medium underline-offset-2 hover:underline"
                style={{ color: "var(--aa-green-dark, #4A7C59)" }}
              >
                hola@adaptaula.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2
              className="mb-2 text-base font-semibold"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              5. Cookies
            </h2>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
            >
              Usamos una cookie de sesión (aa-trial) para gestionar el acceso gratuito. No
              usamos cookies de seguimiento.
            </p>
          </section>

          <section>
            <h2
              className="mb-2 text-base font-semibold"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              6. Contacto
            </h2>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
            >
              Para ejercer tus derechos:{" "}
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
