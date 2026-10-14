export const STEPS = [
  { title: "Parte de tu material", text: "Sube el PDF o la imagen de una ficha, un texto o una actividad que ya utilizas." },
  { title: "Define los apoyos", text: "Elige un perfil guardado con las necesidades funcionales que quieres atender." },
  { title: "Elige cómo prepararlo", text: "Hacer magia prepara y comprueba la ficha automáticamente. Con Revisar antes de crear puedes ajustar primero la propuesta." },
  { title: "Revisa y lleva al aula", text: "Comprueba el resultado y descarga el PDF cuando esté listo. Si no puede completarse, te explicamos el motivo." },
] as const;

export function StepsList() {
  return (
    <ol className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
      {STEPS.map((step, i) => (
        <li key={step.title} className="border-t border-foreground pt-4">
          <span aria-hidden className="font-editorial text-3xl text-primary">0{i + 1}</span>
          <h3 className="mb-2 mt-5 text-lg font-semibold"><span className="sr-only">Paso {i + 1}: </span>{step.title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{step.text}</p>
        </li>
      ))}
    </ol>
  );
}
