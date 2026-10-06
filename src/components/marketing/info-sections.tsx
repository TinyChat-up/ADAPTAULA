import { LinkButton } from "@/components/ui/button";
import { Check } from "lucide-react";
import { PROFILE_AREAS } from "@/lib/profiles/areas";
import { Section } from "./section";
import { StepsList } from "./steps";

export function HowItWorks() {
  return (
    <Section id="como-funciona" title="Cómo funciona" intro="Cuatro pasos, sin cambiar la forma en la que ya preparas tus clases.">
      <StepsList />
    </Section>
  );
}

const ADAPTATION_TYPES = [
  { title: "Accesibilidad", text: "La misma tarea con otro acceso: formato, espaciado, apoyos visuales y forma de responder." },
  { title: "Metodológica", text: "Cambia cómo se presenta y se practica: pasos, ejemplos y andamiaje." },
  { title: "Lingüística", text: "Ajusta vocabulario y construcción de frases sin perder el contenido." },
  { title: "Refuerzo", text: "Más práctica guiada sobre lo esencial, con conocimientos previos a la vista." },
  { title: "Ampliación", text: "Más profundidad y reto. No más ejercicios: mejores preguntas." },
  { title: "Curricular", text: "Ajusta los objetivos. Solo con tu confirmación explícita, porque cambia lo que se evalúa." },
] as const;

export function AdaptationTypes() {
  return (
    <Section id="tipos" title="Tipos de adaptación" intro="Tú decides qué cambia. Por defecto, los objetivos de aprendizaje se mantienen." tone="surface">
      <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {ADAPTATION_TYPES.map((t) => (
          <li key={t.title} className="border-l-2 border-primary/40 pl-4">
            <h3 className="font-semibold">{t.title}</h3>
            <p className="mt-1 text-muted-foreground">{t.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const STAGES = [
  { title: "Primaria", text: "Más apoyo visual y espacio para escribir, con un tono cercano y claro." },
  { title: "ESO", text: "Lenguaje y diseño sobrios. Esquemas y organizadores, sin iconografía infantil." },
  { title: "Bachillerato", text: "Jerarquía clara y densidad conceptual. Se cuida el acceso sin rebajar el nivel por defecto." },
] as const;

export function Stages() {
  return (
    <Section id="etapas" title="Primaria, ESO y Bachillerato" intro="El mismo criterio de fondo, un estilo adecuado a la edad. Adaptar no es infantilizar.">
      <div className="grid gap-6 md:grid-cols-3">
        {STAGES.map((s) => (
          <div key={s.title} className="rounded-card border border-border bg-surface p-6 shadow-card">
            <h3 className="text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-muted-foreground">{s.text}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function Needs() {
  return (
    <Section
      id="necesidades"
      title="Atención a diferentes necesidades"
      intro="Adaptamos por lo que cada alumno necesita, no por una etiqueta."
      tone="surface"
    >
      <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {PROFILE_AREAS.map((area) => (
          <li key={area.id} className="flex items-start gap-2">
            <Check aria-hidden className="mt-1 size-4 shrink-0 text-accent" />
            <span>
              <span className="font-medium">{area.label}.</span> <span className="text-muted-foreground">{area.description}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-8 max-w-3xl text-muted-foreground">
        Si lo prefieres, puedes partir de una configuración orientativa (por ejemplo, para dislexia o TDAH) y modificarla por completo.
        Una configuración orientativa no es un diagnóstico: Adaptaula trabaja con las necesidades que tú indiques.
      </p>
    </Section>
  );
}

const PRIVACY_POINTS = [
  "Usa iniciales o un alias: no necesitamos el nombre completo del alumnado.",
  "No pedimos datos médicos, informes, DNI, fecha de nacimiento ni fotografías.",
  "Los modelos de IA nunca reciben el alias ni las notas del alumno: solo el material y las necesidades funcionales.",
  "Adaptaula propone, tú decides: cada adaptación es un borrador editable y no sustituye al orientador ni a ningún profesional.",
] as const;

export function PrivacySection() {
  return (
    <Section id="privacidad" title="Privacidad por diseño" intro="Trabajamos con información sobre menores, así que recogemos lo mínimo.">
      <ul className="max-w-3xl space-y-3">
        {PRIVACY_POINTS.map((p) => (
          <li key={p} className="flex items-start gap-2">
            <Check aria-hidden className="mt-1 size-4 shrink-0 text-accent" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <LinkButton href="/privacidad" variant="secondary">
          Más sobre privacidad
        </LinkButton>
      </div>
    </Section>
  );
}
