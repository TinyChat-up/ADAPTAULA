export const STEPS = [
  { title: "Sube tu material", text: "Selecciona una ficha en PDF, JPG, PNG o WEBP. El archivo se guarda de forma privada y se comprueba antes de analizarlo." },
  { title: "Elige los apoyos", text: "Usa un perfil funcional con alias: lectura, organización, lenguaje o pasos matemáticos, según lo que necesite la actividad." },
  { title: "Prepara la adaptación", text: "Hacer magia analiza el material y prepara una propuesta. Si una figura o un contenido no se puede comprobar, te lo explica y se detiene." },
  { title: "Revisa y edita", text: "Compara con el original y ajusta enunciados, presentación y espacio de respuesta en un borrador separado." },
  { title: "Descarga el PDF", text: "Descarga la ficha generada o tu revisión guardada. Comprueba el resultado antes de entregarlo al alumnado." },
] as const;

export function StepsList() {
  return (
    <ol className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
      {STEPS.map((step, i) => (
        <li key={step.title} className="min-w-0 border-t border-foreground pt-4">
          <span aria-hidden className="font-editorial text-3xl text-primary">0{i + 1}</span>
          <h3 className="mb-2 mt-5 text-lg font-semibold"><span className="sr-only">Paso {i + 1}: </span>{step.title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{step.text}</p>
        </li>
      ))}
    </ol>
  );
}
