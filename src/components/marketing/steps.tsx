export const STEPS = [
  { title: "Sube tu ficha", text: "Un PDF o una imagen del material que ya utilizas: ficha, texto, examen o problema." },
  { title: "Elige para quién", text: "Usa un perfil guardado o haz una adaptación rápida. Indica qué quieres adaptar." },
  { title: "Revisa la propuesta", text: "Adaptaula te presenta una propuesta editable y te explica qué ha cambiado y por qué." },
  { title: "Descarga y usa", text: "Descarga la ficha en PDF lista para imprimir y repite con otros perfiles sin volver a subirla." },
] as const;

export function StepsList() {
  return (
    <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {STEPS.map((step, i) => (
        <li key={step.title} className="space-y-3">
          <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {i + 1}
          </span>
          <h3 className="text-lg font-semibold">
            <span className="sr-only">Paso {i + 1}: </span>
            {step.title}
          </h3>
          <p className="text-muted-foreground">{step.text}</p>
        </li>
      ))}
    </ol>
  );
}
