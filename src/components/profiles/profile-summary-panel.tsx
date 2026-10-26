import { Compass, Sparkles, Sprout } from "lucide-react";
import type { ProfileSummary } from "@/lib/profiles/summary";

export function ProfileSummaryPanel({ summary }: { summary: ProfileSummary }) {
  return (
    <section className="space-y-6 rounded-panel border border-border bg-surface p-5" aria-label="Revisar el perfil">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">04 · Revisar</p>
        <h2 className="mt-1 text-xl font-semibold">Así acompañaremos su aprendizaje</h2>
        <p className="mt-2 text-sm text-muted-foreground">Lo que has indicado, sin inferir capacidades ni cambiar su curso.</p>
      </div>
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
        <p className="text-xs text-muted-foreground">La ficha debe revisarse. No garantiza una imagen ni permite reducir objetivos curriculares automáticamente.</p>
      </div>
    </section>
  );
}
