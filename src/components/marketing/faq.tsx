import { ChevronDown } from "lucide-react";
import { Section } from "./section";

export const FAQ_ITEMS = [
  {
    q: "¿Adaptaula diagnostica o sustituye al orientador?",
    a: "No. Adaptaula no diagnostica ni evalúa a nadie. Genera propuestas de material que tú revisas y editas, y no sustituye al orientador ni a otros profesionales.",
  },
  {
    q: "¿Tengo que escribir el nombre de mis alumnos?",
    a: "No, y te recomendamos no hacerlo. Puedes identificar cada perfil con iniciales o un alias. No pedimos nombre completo, fecha de nacimiento, DNI, fotografías ni informes.",
  },
  {
    q: "¿Qué materiales puedo subir?",
    a: "Fichas, textos, exámenes o problemas en PDF, JPG, PNG o WEBP. Evita incluir información personal innecesaria en lo que subas.",
  },
  {
    q: "¿Y si no soy experto en adaptaciones?",
    a: "No hace falta. Puedes partir de una configuración orientativa y ver, en lenguaje claro, cómo se aplicará. Todo se puede cambiar.",
  },
  {
    q: "¿Se modifican los objetivos de la ficha?",
    a: "Por defecto no. Solo la adaptación curricular puede cambiarlos, y únicamente con tu confirmación explícita.",
  },
  {
    q: "¿Puedo adaptar la misma ficha para varios alumnos?",
    a: "Sí. La idea es subir la ficha una vez y generar una versión para cada perfil.",
  },
] as const;

export function Faq() {
  return (
    <Section id="faq" title="Preguntas frecuentes">
      <div className="max-w-3xl divide-y divide-border rounded-card border border-border bg-surface">
        {FAQ_ITEMS.map((item) => (
          <details key={item.q} className="group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
              {item.q}
              <ChevronDown aria-hidden className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-3 text-muted-foreground">{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
