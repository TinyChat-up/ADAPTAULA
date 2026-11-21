import { Compass, Sparkles, Sprout } from "lucide-react";
import type { EducationCatalog } from "@/lib/profiles/catalog";
import type { ObservedAbility, PedagogicalProfile } from "@/lib/schemas/pedagogical-profile";
import type { ProfileSummary } from "@/lib/profiles/summary";
import { AUTONOMY_LABELS } from "./ability-fields";

interface LearningSummaryData {
  areas: PedagogicalProfile["areas"];
  subjects: EducationCatalog["subjects"];
}

const INLINE_LEARNING_LIMIT = 4;

function LearningSummary({ areas, subjects }: LearningSummaryData) {
  const groups = areas.flatMap((area) => {
    const abilities: ObservedAbility[] = [
      ...area.knows.map((statement) => ({ statement, autonomy: "unassessed" as const })),
      ...(area.abilities ?? []),
    ].filter((ability) => ability.statement.trim());
    const needs = area.needs.filter((statement) => statement.trim());
    if (!abilities.length && !needs.length) return [];
    const title = subjects?.find((subject) => subject.slug === area.subject)?.name ?? area.subject;
    return [{ subject: area.subject, title, abilities, needs }];
  });
  if (groups.length === 0) return null;

  const total = groups.reduce((count, group) => count + group.abilities.length + group.needs.length, 0);
  const list = (
    <div className="space-y-3 text-sm [overflow-wrap:anywhere]">
      {groups.map((group) => (
        <div key={group.subject}>
          <h3 className="font-semibold">{group.title}</h3>
          {group.abilities.length > 0 ? (
            <ul className="mt-1 space-y-2">
              {group.abilities.map((ability, index) => (
                <li key={index}>
                  {ability.statement}
                  <span className="block text-muted-foreground">{AUTONOMY_LABELS[ability.autonomy]}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {group.needs.length > 0 ? (
            <div className="mt-2">
              <p className="font-medium">Por reforzar</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {group.needs.map((statement, index) => <li key={index}>{statement}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
  return total <= INLINE_LEARNING_LIMIT ? list : (
    <details className="text-sm">
      <summary className="min-h-9 cursor-pointer font-medium">Ver todos los aprendizajes ({total})</summary>
      {list}
    </details>
  );
}

export function ProfileSummaryPanel({ summary, learning }: { summary: ProfileSummary; learning?: LearningSummaryData }) {
  return (
    <section className="space-y-6 rounded-panel border border-border bg-surface p-5" aria-label="Revisar el perfil">
      <div>
        <h2 className="mt-1 text-xl font-semibold">Así acompañaremos su aprendizaje</h2>
        <p className="mt-2 text-sm text-muted-foreground">Resumen de lo que has indicado.</p>
        {summary.learningAreas > 0 ? <p className="mt-2 text-sm">{summary.learningAreas === 1 ? "Aprendizajes en una asignatura" : `Aprendizajes en ${summary.learningAreas} asignaturas`}</p> : null}
        {summary.supportedShortAnswers ? <p className="mt-2 text-sm">Prefiere respuestas breves con apoyos cuando el objetivo lo permite.</p> : null}
      </div>
      {learning ? <LearningSummary {...learning} /> : null}
      <div className="space-y-2">
        <h3 className="flex items-center gap-2 font-semibold"><Sprout aria-hidden className="size-4" />Sus fortalezas</h3>
        {summary.strengths.length ? <ul className="list-inside list-disc space-y-2 text-sm">{summary.strengths.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="text-sm text-muted-foreground">Todavía no indicadas. No las deducimos de los apoyos.</p>}
      </div>
      <div className="space-y-2 border-t border-border pt-5">
        <h3 className="flex items-center gap-2 font-semibold"><Compass aria-hidden className="size-4" />Barreras que queremos reducir</h3>
        {summary.barriers.length ? <ul className="list-inside list-disc space-y-2 text-sm">{summary.barriers.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="text-sm text-muted-foreground">Todavía no indicadas. Seleccionar apoyos no declara una barrera.</p>}
      </div>
      <div className="space-y-2 border-t border-border pt-5">
        <h3 className="flex items-center gap-2 font-semibold"><Sparkles aria-hidden className="size-4" />Cómo ayudará Adaptaula</h3>
        <p className="text-sm text-muted-foreground">{summary.intro}</p>
        <ul className="space-y-2 text-sm">{summary.lines.slice(0, 5).map((line) => <li key={line.text}>{line.text}{line.level ? <span className="text-muted-foreground"> ({line.level})</span> : null}</li>)}</ul>
        {summary.lines.length > 5 ? <details className="text-sm"><summary className="min-h-9 cursor-pointer font-medium">Ver {summary.lines.length - 5} apoyos y ajustes más</summary><ul className="mt-2 space-y-2">{summary.lines.slice(5).map((line) => <li key={line.text}>{line.text}{line.level ? <span className="text-muted-foreground"> ({line.level})</span> : null}</li>)}</ul></details> : null}
        {summary.notNeeded.length > 0 ? <details className="text-sm"><summary className="min-h-9 cursor-pointer font-medium">Apoyos marcados como no necesarios ({summary.notNeeded.length})</summary><ul className="mt-2 list-inside list-disc space-y-2">{summary.notNeeded.map((line) => <li key={line}>{line}</li>)}</ul></details> : null}
        <p className="text-xs text-muted-foreground">Los apoyos se eligen según la ficha y sus objetivos.</p>
      </div>
    </section>
  );
}
