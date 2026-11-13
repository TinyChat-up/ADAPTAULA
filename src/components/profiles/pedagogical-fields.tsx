import { SelectField, TextareaField } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";
import type { EducationCatalog } from "@/lib/profiles/catalog";
import { type PedagogicalProfile, type RESPONSE_PREFERENCES, type ADAPTATION_PREFERENCES } from "@/lib/schemas/pedagogical-profile";

const responses: Record<(typeof RESPONSE_PREFERENCES)[number], string> = { write: "Escribir", oral: "Responder oralmente", match: "Unir", fill_blanks: "Completar", order: "Ordenar", select: "Seleccionar", classify: "Clasificar" };
const adaptations: Record<(typeof ADAPTATION_PREFERENCES)[number], string> = { accessibility: "Acceso", methodological: "Metodológica", linguistic: "Lingüística", reinforcement: "Refuerzo", enrichment: "Ampliación", curricular: "Curricular" };

export function PedagogicalAreas({ value, catalog, onChange }: { value: PedagogicalProfile; catalog: EducationCatalog; onChange: (value: PedagogicalProfile) => void }) {
  const update = (index: number, area: PedagogicalProfile["areas"][number]) => onChange({ ...value, areas: value.areas.map((a, i) => i === index ? area : a) });
  const remaining = (catalog.subjects ?? []).filter((s) => !value.areas.some((a) => a.subject === s.slug));
  return <details className="rounded-card border border-border p-4">
    <summary className="cursor-pointer font-medium">Nivel y aprendizajes por área (opcional)</summary>
    <div className="mt-4 space-y-5">
      <p className="text-sm text-muted-foreground">El nivel es orientativo y no se deduce del curso ni de los apoyos. Escribe solo información educativa, sin nombres, diagnósticos ni datos médicos.</p>
      {value.areas.map((area, i) => <section key={area.subject} className="space-y-4 rounded-card border border-border p-4" aria-label={`Área ${catalog.subjects?.find((s) => s.slug === area.subject)?.name ?? area.subject}`}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{catalog.subjects?.find((s) => s.slug === area.subject)?.name ?? area.subject}</h3><Button variant="ghost" onClick={() => onChange({ ...value, areas: value.areas.filter((_, n) => n !== i) })}>Quitar área</Button></div>
        <SelectField label="Nivel orientativo en esta área" value={area.reference_grade ?? ""} onChange={(e) => update(i, { ...area, reference_grade: e.target.value || null })}><option value="">Sin valorar</option>{catalog.grades.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}</SelectField>
        <TextareaField label="Qué sabe hacer" optional hint="Hasta cinco ideas, una por línea y con un máximo de 180 caracteres cada una." value={area.knows.join("\n")} onChange={(e) => update(i, { ...area, knows: e.target.value.split("\n") })} rows={2} />
        <TextareaField label="Qué necesita aprender o reforzar" optional hint="Hasta cinco ideas, una por línea y con un máximo de 180 caracteres cada una." value={area.needs.join("\n")} onChange={(e) => update(i, { ...area, needs: e.target.value.split("\n") })} rows={2} />
      </section>)}
      {remaining.length > 0 ? <SelectField label="Añadir un área" value="" onChange={(e) => { if (e.target.value) onChange({ ...value, areas: [...value.areas, { subject: e.target.value, reference_grade: null, knows: [], needs: [] }] }); }}><option value="">Elige una asignatura</option>{remaining.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</SelectField> : null}
    </div>
  </details>;
}

export function PedagogicalPreferences({ value, onChange }: { value: PedagogicalProfile; onChange: (value: PedagogicalProfile) => void }) {
  const choices = <K extends "response_preferences" | "adaptation_preferences">(key: K, labels: Record<PedagogicalProfile[K][number], string>) => (Object.keys(labels) as PedagogicalProfile[K][number][]).map((id) => <label key={id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={(value[key] as string[]).includes(id)} onChange={() => onChange({ ...value, [key]: (value[key] as string[]).includes(id) ? value[key].filter((x) => x !== id) : [...value[key], id] })} />{labels[id]}</label>);
  return <>
    <details className="rounded-card border border-border p-4"><summary className="cursor-pointer font-medium">Formas de respuesta disponibles (opcional)</summary><p className="mt-3 text-sm text-muted-foreground">Son opciones, no cambios automáticos: dependen de la actividad y de lo que se evalúa.</p><fieldset className="mt-2"><legend className="sr-only">Formas de respuesta</legend>{choices("response_preferences", responses)}</fieldset></details>
    <section aria-labelledby="preferencias-adaptacion" className="space-y-3"><h2 id="preferencias-adaptacion" className="text-xl font-semibold">D · Preferencias de adaptación</h2><p className="text-sm text-muted-foreground">Estas preferencias no autorizan cambios de objetivos. La autorización curricular y su alcance se decidirán para cada ficha antes de crearla.</p><fieldset><legend className="sr-only">Tipos de adaptación preferidos</legend>{choices("adaptation_preferences", adaptations)}</fieldset></section>
  </>;
}

export function PedagogicalReadOnly({ value, catalog }: { value: PedagogicalProfile; catalog: EducationCatalog }) {
  return <section className="space-y-3"><h2 className="text-xl font-semibold">Información pedagógica guardada</h2><p className="text-sm">Esta información todavía no interviene en la generación de fichas.</p>{value.areas.map((a) => <div key={a.subject}><h3 className="font-semibold">{catalog.subjects?.find((s) => s.slug === a.subject)?.name ?? a.subject}</h3><p>Nivel: {catalog.grades.find((g) => g.slug === a.reference_grade)?.name ?? "Sin valorar"}</p><p>Qué sabe hacer: {a.knows.join("; ") || "Sin indicar"}</p><p>Qué necesita aprender o reforzar: {a.needs.join("; ") || "Sin indicar"}</p></div>)}<p>Formas de respuesta: {value.response_preferences.map((x) => responses[x]).join(", ") || "Sin indicar"}</p><p>Tipos de adaptación: {value.adaptation_preferences.map((x) => adaptations[x]).join(", ") || "Sin indicar"}</p><p>Las preferencias no autorizan cambios de objetivos.</p></section>;
}
