import { SelectField, TextareaField } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";
import type { EducationCatalog } from "@/lib/profiles/catalog";
import { LEARNINGS_PER_AREA, LEARNING_STATEMENT_LIMIT, type PedagogicalProfile, type RESPONSE_PREFERENCES, type ADAPTATION_PREFERENCES } from "@/lib/schemas/pedagogical-profile";
import { AbilityFields, AUTONOMY_LABELS } from "./ability-fields";

const responses: Record<(typeof RESPONSE_PREFERENCES)[number], string> = { write: "Escribir", oral: "Responder oralmente", match: "Unir", fill_blanks: "Completar", order: "Ordenar", select: "Seleccionar", classify: "Clasificar" };
const adaptations: Record<(typeof ADAPTATION_PREFERENCES)[number], string> = { accessibility: "Acceso", methodological: "Metodológica", linguistic: "Lingüística", reinforcement: "Refuerzo", enrichment: "Ampliación", curricular: "Curricular" };
const linesHint = `Hasta ${LEARNINGS_PER_AREA} ideas, una por línea (máximo ${LEARNING_STATEMENT_LIMIT} caracteres cada una).`;
const subjectLabel = (catalog: EducationCatalog, slug: string) => catalog.subjects?.find((subject) => subject.slug === slug)?.name ?? slug;

export function PedagogicalAreas({ value, catalog, onChange, compact = false }: { value: PedagogicalProfile; catalog: EducationCatalog; compact?: boolean; onChange: (value: PedagogicalProfile) => void }) {
  const update = (index: number, area: PedagogicalProfile["areas"][number]) => onChange({ ...value, areas: value.areas.map((a, i) => i === index ? area : a) });
  const remaining = (catalog.subjects ?? []).filter((s) => !value.areas.some((a) => a.subject === s.slug));

  return (
    <section className="space-y-3" aria-labelledby="aprendizajes-titulo">
      {compact ? null : (
        <div>
          <h2 id="aprendizajes-titulo" className="text-xl font-semibold">¿Qué sabe hacer?</h2>
          <h2 className="text-xl font-semibold">¿Qué necesita aprender o mejorar?</h2>
        </div>
      )}
      <details open={!compact && value.areas.length > 0 ? true : undefined} className={compact ? "workspace-disclosure" : "rounded-card border border-border p-4"}>
        <summary id={compact ? "aprendizajes-titulo" : undefined} className="min-h-9 cursor-pointer font-medium">Aprendizajes por asignatura{value.areas.length > 0 ? ` (${value.areas.length})` : ""}</summary>
        <div className={compact ? "space-y-5 pb-4 pt-2" : "mt-3 space-y-5"}>
          {compact ? <p className="text-sm">Al elegir una asignatura puedes indicar qué sabe hacer y qué necesita reforzar.</p> : null}
          <p className="text-sm text-muted-foreground">Anota solo información educativa. Evita nombres, diagnósticos y datos médicos.</p>
          {value.areas.map((area, i) => (
            <section key={area.subject} className="min-w-0 space-y-4 rounded-card border border-border p-4" aria-label={subjectLabel(catalog, area.subject)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{subjectLabel(catalog, area.subject)}</h3>
                <Button variant="ghost" aria-label={`Quitar ${subjectLabel(catalog, area.subject)} del perfil`} onClick={() => onChange({ ...value, areas: value.areas.filter((_, n) => n !== i) })}>Quitar asignatura</Button>
              </div>
              <AbilityFields value={area.abilities ?? []} onChange={(abilities) => update(i, { ...area, abilities })} />
              {area.knows.length > 0 ? <TextareaField label="Aprendizajes guardados con autonomía sin valorar" value={area.knows.join("\n")} onChange={(e) => update(i, { ...area, knows: e.target.value.split("\n") })} hint={linesHint} rows={2} /> : null}
              <TextareaField label="Qué necesita aprender o mejorar" optional hint={`Por ejemplo, interpretar las escalas de un gráfico. ${linesHint}`} value={area.needs.join("\n")} onChange={(e) => update(i, { ...area, needs: e.target.value.split("\n") })} rows={2} />
              <details className="text-sm">
                <summary className="min-h-9 cursor-pointer font-medium">Nivel orientativo en esta asignatura</summary>
                <SelectField label="Nivel orientativo" hint="Puede ser distinto de su curso. Si lo desconoces, deja «Sin valorar»." value={area.reference_grade ?? ""} onChange={(e) => update(i, { ...area, reference_grade: e.target.value || null })}>
                  <option value="">Sin valorar</option>
                  {catalog.grades.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
                </SelectField>
              </details>
            </section>
          ))}
          {remaining.length > 0 && value.areas.length < 30 ? (
            <SelectField label="Añadir una asignatura" value="" onChange={(e) => {
              if (e.target.value) onChange({ ...value, areas: [...value.areas, { subject: e.target.value, reference_grade: null, knows: [], needs: [] }] });
            }}>
              <option value="">Elige una asignatura</option>
              {remaining.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
            </SelectField>
          ) : null}
        </div>
      </details>
    </section>
  );
}

export function PedagogicalPreferences({ value, onChange }: { value: PedagogicalProfile; onChange: (value: PedagogicalProfile) => void }) {
  const choices = <K extends "response_preferences" | "adaptation_preferences">(key: K, labels: Record<PedagogicalProfile[K][number], string>) => (Object.keys(labels) as PedagogicalProfile[K][number][]).map((id) => <label key={id} className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-4 shrink-0 accent-primary" checked={(value[key] as string[]).includes(id)} onChange={() => onChange({ ...value, [key]: (value[key] as string[]).includes(id) ? value[key].filter((x) => x !== id) : [...value[key], id] })} />{labels[id]}</label>);
  return (
    <section aria-labelledby="respuestas-titulo" className="space-y-3">
      <h2 id="respuestas-titulo" className="text-xl font-semibold">¿Cómo suele responder mejor?</h2>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-card border border-border p-4 font-medium">
        <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={value.short_responses_with_support === true} aria-describedby="respuestas-breves-ayuda" onChange={(e) => onChange({ ...value, short_responses_with_support: e.target.checked ? true : undefined })} />
        Respuestas breves con apoyos
      </label>
      <p id="respuestas-breves-ayuda" className="text-sm text-muted-foreground">Esta preferencia se guarda para el futuro. Cuando el objetivo sea redactar, argumentar o producir un texto, se conserva esa exigencia.</p>
      <details className="rounded-card border border-border p-4">
        <summary className="min-h-9 cursor-pointer font-medium">Otras formas de respuesta y preferencias</summary>
        <p className="my-2 text-sm text-muted-foreground">La forma de responder depende de la tarea. Los cambios de objetivos requieren autorización para cada ficha.</p>
        <fieldset><legend className="font-medium">Formas de respuesta disponibles</legend>{choices("response_preferences", responses)}</fieldset>
        <fieldset className="mt-3"><legend className="font-medium">Tipos de adaptación preferidos</legend>{choices("adaptation_preferences", adaptations)}</fieldset>
      </details>
    </section>
  );
}

export function PedagogicalReadOnly({ value, catalog }: { value: PedagogicalProfile; catalog: EducationCatalog }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Información pedagógica guardada</h2>
      {value.areas.map((area) => (
        <div key={area.subject} className="space-y-1">
          <h3 className="font-semibold">{subjectLabel(catalog, area.subject)}</h3>
          <p>Nivel orientativo {catalog.grades.find((g) => g.slug === area.reference_grade)?.name ?? "sin valorar"}</p>
          <ul className="list-disc pl-5">
            {area.knows.map((statement, i) => <li key={`legacy-${i}`}>{statement} · Autonomía sin valorar</li>)}
            {area.abilities?.map((ability, i) => <li key={i}>{ability.statement} · {AUTONOMY_LABELS[ability.autonomy]}</li>)}
          </ul>
          <p>Qué necesita aprender o mejorar</p>
          {area.needs.length > 0 ? <ul className="list-disc pl-5">{area.needs.map((statement, i) => <li key={i}>{statement}</li>)}</ul> : <p>Sin indicar</p>}
        </div>
      ))}
      <p>Formas de respuesta {value.response_preferences.map((x) => responses[x]).join(", ") || "sin indicar"}</p>
      {value.short_responses_with_support ? <p>Prefiere respuestas breves con apoyos cuando el objetivo lo permite.</p> : null}
      <p>Tipos de adaptación preferidos {value.adaptation_preferences.map((x) => adaptations[x]).join(", ") || "sin indicar"}</p>
    </section>
  );
}
