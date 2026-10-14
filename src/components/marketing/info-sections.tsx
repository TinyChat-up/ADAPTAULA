import { LinkButton } from "@/components/ui/button";
import { PROFILE_AREAS } from "@/lib/profiles/areas";
import { Section } from "./section";
import { StepsList } from "./steps";

export function HowItWorks() {
  return <Section id="como-funciona" eyebrow="Del material al aula" title="Tu criterio, en cada paso." intro="Un recorrido sencillo, con preparación automática o revisión previa de la propuesta."><StepsList /></Section>;
}

const TYPES = [
  ["Accesibilidad", "La misma tarea con otro acceso: formato, espaciado, apoyos visuales y forma de responder."],
  ["Metodológica", "Cambia cómo se presenta y se practica: pasos, ejemplos y andamiaje."],
  ["Lingüística", "Ajusta vocabulario y construcción de frases sin perder el contenido."],
  ["Refuerzo", "Práctica guiada sobre lo esencial, con conocimientos previos a la vista."],
  ["Ampliación", "Profundidad y reto, a partir de los objetivos del material."],
  ["Curricular", "Puede ajustar objetivos y nivel. Solo con tu confirmación explícita."],
];

export function AdaptationTypes() {
  return (
    <Section id="tipos" eyebrow="El propósito de la adaptación" title="Cambiar el acceso. Cuidar el aprendizaje." intro="Selecciona qué necesitas adaptar. Por defecto, los objetivos de aprendizaje se mantienen." tone="surface">
      <dl className="grid gap-x-12 sm:grid-cols-2">
        {TYPES.map(([title, text], i) => (
          <div key={title} className="border-t border-border py-6">
            <dt className="flex items-baseline gap-4 text-lg font-semibold"><span aria-hidden className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">0{i + 1}</span>{title}</dt>
            <dd className="mt-2 max-w-md pl-10 text-sm leading-relaxed text-muted-foreground">{text}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

const STAGES = [
  ["Primaria", "Apoyos claros y espacio para responder, con un tono cercano y adecuado a la edad."],
  ["ESO", "Lenguaje y diseño sobrios. Estructura y organización, sin iconografía infantil."],
  ["Bachillerato", "Jerarquía clara y densidad conceptual. Cuidamos el acceso sin rebajar el nivel por defecto."],
];

export function Stages() {
  return (
    <Section id="etapas" eyebrow="Para cada etapa" title="Adaptar no es infantilizar." intro="El mismo criterio de fondo, una presentación adecuada a la edad.">
      <div className="grid gap-8 md:grid-cols-3">
        {STAGES.map(([title, text]) => <div key={title} className="border-l-2 border-primary pl-5"><h3 className="text-xl font-semibold">{title}</h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{text}</p></div>)}
      </div>
    </Section>
  );
}

export function Needs() {
  return (
    <Section id="necesidades" eyebrow="Necesidades funcionales" title="Un perfil de apoyos, no una etiqueta." intro="Indica lo que tu alumnado necesita para trabajar con el material." tone="surface">
      <ul className="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
        {PROFILE_AREAS.map((area) => <li key={area.id} className="border-t border-border py-4"><h3 className="font-semibold">{area.label}</h3><p className="mt-1 text-sm text-muted-foreground">{area.description}</p></li>)}
      </ul>
      <p className="mt-8 max-w-3xl text-sm leading-relaxed text-muted-foreground">Puedes partir de una configuración de apoyo a la lectura o a la organización y modificarla. Un punto de partida no es un diagnóstico: Adaptaula trabaja con las necesidades que tú indiques.</p>
    </Section>
  );
}

const PRIVACY = [
  ["Identidad mínima", "Usa iniciales o un alias. No necesitamos el nombre completo del alumnado."],
  ["Solo lo necesario", "No pedimos datos médicos, informes, DNI, fecha de nacimiento ni fotografías."],
  ["Necesidades, no nombres", "Los modelos de IA reciben el material y las necesidades funcionales, nunca el alias del perfil."],
  ["Criterio profesional", "Adaptaula propone. Tú revisas el resultado y decides cómo utilizarlo en clase."],
];

export function PrivacySection() {
  return (
    <Section id="privacidad" eyebrow="Confianza" title="El cuidado también está en los datos." intro="Recogemos lo mínimo para preparar los materiales.">
      <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
        <div><p className="font-editorial text-2xl leading-relaxed">Detrás de cada ficha hay una persona. Su información merece cuidado.</p><LinkButton href="/privacidad" variant="secondary" className="mt-6">Más sobre privacidad</LinkButton></div>
        <dl className="editorial-list">{PRIVACY.map(([term, detail]) => <div key={term} className="grid gap-2 py-5 sm:grid-cols-[10rem_1fr]"><dt className="font-semibold">{term}</dt><dd className="text-sm leading-relaxed text-muted-foreground">{detail}</dd></div>)}</dl>
      </div>
    </Section>
  );
}
