import { AlertTriangle, EyeOff, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import {
  ACTIVITY_TYPE_LABELS,
  ANSWER_AREA_LABELS,
  DIFFICULTY_LABELS,
  IMPORTANCE_LABELS,
  PROTECTED_TYPE_LABELS,
  UNCERTAINTY_KIND_LABELS,
  VISUAL_KIND_LABELS,
  VISUAL_ROLE_LABELS,
} from "@/lib/analysis/labels";
import type { AnalysisVisual, MaterialAnalysis } from "@/lib/schemas/material-analysis";

const LOW_CONFIDENCE = 0.7;

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** What to say about a visual: its title and description, or the shape of its structured data when that is all there is. */
function visualSummary(v: AnalysisVisual): string {
  const data = v.table ? `${v.table.rows.length} filas` : v.chart ? `${v.chart.categories.length} categorías` : "";
  return [v.title, v.description, data].filter((part) => part && part.length > 0).join(" · ") || "Sin descripción";
}

export function IdentifiedCard({ analysis, reused }: { analysis: MaterialAnalysis; reused: boolean }) {
  const { identification: i, pedagogical_intent: intent, structure } = analysis;
  const rows: Array<[string, React.ReactNode]> = [
    ["Tema", i.topic.value ?? "No se ha podido determinar"],
    ["Actividades", structure.counts.activities],
    ["Dificultad aproximada", DIFFICULTY_LABELS[intent.difficulty]],
  ];
  return (
    <Card className="space-y-5">
      <h2 className="text-xl font-semibold">Adaptaula ha identificado</h2>
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt className="text-sm text-muted-foreground">{term}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Qué pretende el material</p>
        <p>{intent.purpose}</p>
      </div>
      {intent.objectives.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Objetivos principales</p>
          <ul className="list-disc space-y-1 pl-5">
            {intent.objectives.map((o) => (
              <li key={o.id}>{o.text}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {reused ? <p className="text-sm text-muted-foreground">Hemos reutilizado el análisis de este mismo archivo, que ya habías subido antes.</p> : null}
    </Card>
  );
}

export function ReviewNotice({ analysis }: { analysis: MaterialAnalysis }) {
  const { uncertainties, quality } = analysis;
  if (uncertainties.length === 0 && quality.readability === "good") return null;
  return (
    <Card className="space-y-3 border-warning/40 bg-warning/5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <AlertTriangle aria-hidden className="size-5 text-warning" />
        Conviene que revises estos puntos
      </h2>
      {quality.readability !== "good" ? (
        <p className="text-sm">{quality.readability === "poor" ? "El material se lee con dificultad: parte del análisis puede ser incompleto." : "Hay partes del material que no se leen del todo bien."}</p>
      ) : null}
      <ul className="space-y-2 text-sm">
        {uncertainties.map((u) => (
          <li key={u.id}>
            <span className="font-medium">{UNCERTAINTY_KIND_LABELS[u.kind]}</span>
            {u.page ? ` (página ${u.page})` : ""}: {u.note}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ActivitiesList({ analysis }: { analysis: MaterialAnalysis }) {
  if (analysis.activities.length === 0) {
    return (
      <Section title="Actividades detectadas">
        <p className="text-muted-foreground">No hemos identificado actividades en este material.</p>
      </Section>
    );
  }
  return (
    <Section title="Actividades detectadas" description={`${analysis.activities.length} en total.`}>
      <ol className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card">
        {analysis.activities.map((a, index) => (
          <li key={a.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Actividad {a.label ?? index + 1}</span>
              <Badge>{ACTIVITY_TYPE_LABELS[a.type]}</Badge>
              <Badge>Dificultad {DIFFICULTY_LABELS[a.difficulty].toLowerCase()}</Badge>
              <span className="text-xs text-muted-foreground">Página {a.page}</span>
              {a.confidence < LOW_CONFIDENCE ? <span className="text-xs font-medium text-warning">Conviene revisarla</span> : null}
            </div>
            <p className="text-sm">{a.instruction}</p>
            {a.context ? <p className="text-sm text-muted-foreground">{a.context}</p> : null}
            {a.answer_area.type !== "none" && a.answer_area.type !== "unknown" ? (
              <p className="text-xs text-muted-foreground">
                Espacio para responder: {ANSWER_AREA_LABELS[a.answer_area.type].toLowerCase()}
                {a.answer_area.lines ? ` (unas ${a.answer_area.lines})` : ""}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function ProtectedList({ analysis }: { analysis: MaterialAnalysis }) {
  if (analysis.protected_elements.length === 0) return null;
  return (
    <Section title="Lo que conviene conservar" description="Elementos que una adaptación debería cuidar de no destruir.">
      <ul className="grid gap-3 sm:grid-cols-2">
        {analysis.protected_elements.map((p) => (
          <li key={p.id} className="rounded-card border border-border bg-surface p-4 shadow-card">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck aria-hidden className="size-4 text-accent" />
              {PROTECTED_TYPE_LABELS[p.type]}
              {p.importance !== "important" ? <Badge tone={p.importance === "essential" ? "accent" : "neutral"}>{IMPORTANCE_LABELS[p.importance]}</Badge> : null}
            </p>
            <p className="mt-1">{p.value}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function VisualsList({ analysis }: { analysis: MaterialAnalysis }) {
  if (analysis.visuals.length === 0) return null;
  return (
    <Section title="Elementos visuales" description="Distinguimos lo que aporta información de lo meramente decorativo.">
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card">
        {analysis.visuals.map((v) => (
          <li key={v.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 p-4">
            {v.role === "decorative" ? <EyeOff aria-hidden className="mt-0.5 size-4 text-muted-foreground" /> : null}
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{VISUAL_KIND_LABELS[v.kind]}</span> · página {v.page}: {visualSummary(v)}
              </p>
            </div>
            <Badge tone={v.role === "required" ? "accent" : "neutral"}>{VISUAL_ROLE_LABELS[v.role]}</Badge>
          </li>
        ))}
      </ul>
    </Section>
  );
}
