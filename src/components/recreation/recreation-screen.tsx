import { BookOpenCheck, Lightbulb, ListChecks, RefreshCw, Scissors, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { MaterialSheet } from "@/components/material/sheet";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import { generatedWidthMm } from "@/lib/render/generated";
import { sheetModel } from "@/lib/render/sheet-model";
import type { RecreationView } from "@/lib/recreation/view";

/**
 * The screen of a recreated material (ADR-051): what the teacher needs to understand it in a few seconds and use it in class.
 * One page, no tabs that load anything: the explanation (what, why, how) beside the student's sheet and the materials to cut out.
 * Everything comes from the stored record (`RecreationView`); nothing here calls a model, and there are no answers, verification
 * states or technical warnings. Regenerating is a separate, explicit action. Server component: no client JavaScript.
 */
export interface RecreationScreenProps {
  view: RecreationView;
  /** Where each stored picture is read from (a signed URL of the private asset, or the pinned bytes): never generated again. */
  imageSrc: Readonly<Record<string, string>>;
  /** The original's own pictures reused as they are (option A), by visual id: the authorised crop route. */
  originals?: Readonly<Record<string, string>>;
  subjectLabel: string;
  /** Optional actions; absent ones are not shown. */
  downloads?: { sheet?: string; materials?: string };
  regenerate?: ReactNode;
  /** Link to look at another version (looking reads the stored version; nothing is generated). */
  versionHref?: (version: number) => string;
  /** Restoring an older version as the current one: a server action that re-checks the role. Absent: not offered. */
  restore?: (version: number) => ReactNode;
}

export function RecreationScreen({ view, imageSrc, originals = {}, subjectLabel, downloads, regenerate, versionHref, restore }: RecreationScreenProps) {
  const generated = Object.fromEntries(view.assets.map((a) => [a.asset_id, { src: imageSrc[a.asset_id] ?? "", widthMm: generatedWidthMm(a.width, a.height) }]));
  // The same projection as the viewer, the editor and the PDF (one renderer for screen and print).
  const assets = Object.fromEntries(Object.entries(originals).map(([visualId, src]) => [visualId, { src }]));
  const student = sheetModel({ document: view.student, subjectName: null, generated, assets, deferred: [] }, "student").model;
  const materials = view.materials ? sheetModel({ document: view.materials, subjectName: null, deferred: [], generated }, "student").model : null;
  const activities = view.explanation.observe.length;

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <p className="eyebrow text-muted-foreground">Material recreado · {subjectLabel}</p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="font-display text-page font-semibold">{view.title}</h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Una ficha nueva con {activities} actividades{materials ? " y materiales para recortar" : ""}, preparada para este alumno.
            </p>
          </div>
          {downloads?.sheet || downloads?.materials ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              {downloads.sheet ? <a className="inline-flex min-h-11 items-center gap-2 rounded-control border border-control-border bg-surface px-4 text-sm font-medium hover:border-primary hover:bg-primary-soft" href={downloads.sheet}>Descargar ficha</a> : null}
              {downloads.materials ? <a className="inline-flex min-h-11 items-center gap-2 rounded-control border border-control-border bg-surface px-4 text-sm font-medium hover:border-primary hover:bg-primary-soft" href={downloads.materials}>Descargar materiales</a> : null}
            </div>
          ) : null}
        </div>
        {view.version !== view.currentVersion ? <Alert tone="info" title={`Estás viendo la versión ${view.version}`}>La versión que se usa ahora es la {view.currentVersion}.</Alert> : null}
        {/* Never hidden to simplify the screen: an incomplete material, or one that needs a look before use, says so in one line. */}
        {view.state.kind === "incomplete" ? <Alert tone="warning" title="Falta algo antes de usarla">{view.state.message}</Alert> : null}
        {view.state.kind === "review" ? <Alert tone="info" title="Revísala antes de usarla">{view.state.message}</Alert> : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        {/* On a phone the explanation comes first: it is what lets the teacher understand the material at a glance. */}
        <aside aria-label="Explicación para el docente" className="order-first space-y-4 lg:sticky lg:top-6 lg:order-last">
          <Explanation icon={<Sparkles aria-hidden className="size-5 text-accent" />} title="Qué hemos adaptado">
            <ul className="space-y-2">{view.explanation.adapted.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </Explanation>
          <Explanation icon={<Lightbulb aria-hidden className="size-5 text-accent" />} title="Por qué así">
            <ul className="space-y-2">{view.explanation.why.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </Explanation>
          <Explanation icon={<ListChecks aria-hidden className="size-5 text-accent" />} title="Cómo utilizarlos">
            <ol className="list-decimal space-y-2 pl-5">{view.explanation.how_to_use.map((t, i) => <li key={i}>{t}</li>)}</ol>
            <details className="mt-4 rounded-control border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Qué observar en cada actividad</summary>
              <ul className="mt-3 space-y-2">{view.explanation.observe.map((o) => <li key={o.activity}><span className="font-semibold">{o.activity}.</span> {o.text}</li>)}</ul>
            </details>
          </Explanation>
          {view.versions.length > 1 && versionHref ? (
            <details className="rounded-card border border-border bg-surface p-4 text-sm">
              <summary className="cursor-pointer font-medium">Versiones ({view.versions.length})</summary>
              <ul className="mt-3 space-y-2">
                {view.versions.map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center justify-between gap-2">
                    <a href={versionHref(v.version)} className="underline-offset-2 hover:underline" aria-current={v.version === view.version ? "page" : undefined}>Versión {v.version}{v.current ? " (la que se usa)" : ""}</a>
                    {!v.current && restore ? restore(v.version) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {regenerate ? (
            <details className="rounded-card border border-border bg-surface p-4 text-sm">
              <summary className="flex cursor-pointer items-center gap-2 font-medium"><RefreshCw aria-hidden className="size-4" /> Regenerar el material</summary>
              <div className="mt-3 space-y-3 text-muted-foreground">{regenerate}</div>
            </details>
          ) : null}
        </aside>

        <div className="min-w-0 space-y-10">
          <nav aria-label="Partes del material" className="flex flex-wrap gap-2 text-sm">
            <a href="#ficha" className="inline-flex min-h-9 items-center gap-2 rounded-full bg-primary-soft px-3 font-medium text-primary"><BookOpenCheck aria-hidden className="size-4" /> Ficha del alumno</a>
            {materials ? <a href="#materiales" className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border px-3 font-medium"><Scissors aria-hidden className="size-4" /> Materiales para recortar</a> : null}
          </nav>
          <section id="ficha" aria-labelledby="ficha-title" className="scroll-mt-6 space-y-3">
            <h2 id="ficha-title" className="text-lg font-semibold">Ficha del alumno</h2>
            <div className="ms-stage xl:[zoom:0.8]" role="region" aria-label="Hojas de la ficha (se pueden desplazar)" tabIndex={0}>
              <MaterialSheet model={student} />
            </div>
          </section>
          {materials ? (
            <section id="materiales" aria-labelledby="materiales-title" className="scroll-mt-6 space-y-3">
              <h2 id="materiales-title" className="text-lg font-semibold">Materiales para recortar</h2>
              <p className="text-sm text-muted-foreground">Cada hoja indica para qué actividad es. Imprímelas aparte.</p>
              <div className="ms-stage xl:[zoom:0.8]" role="region" aria-label="Hojas de materiales (se pueden desplazar)" tabIndex={0}>
                <MaterialSheet model={materials} />
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Explanation({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="space-y-3 text-sm leading-relaxed">
      <h2 className="flex items-center gap-2 text-base font-semibold">{icon}{title}</h2>
      {children}
    </Card>
  );
}

/** The regenerate action's content: what will happen, before anything does. The button posts to a server action that re-checks all. */
export function RegenerateNotice({ action, disabledReason }: { action?: (formData: FormData) => void | Promise<void>; disabledReason?: string }) {
  return (
    <>
      <p>Se creará una versión nueva del material y se usará una adaptación de tu plan. Las versiones anteriores se conservan y puedes volver a ellas.</p>
      <form action={action}>
        <input type="hidden" name="confirmed" value="1" />
        <Button type="submit" variant="secondary" disabled={!action} title={disabledReason}>Crear una versión nueva</Button>
      </form>
      {disabledReason ? <p className="text-xs">{disabledReason}</p> : null}
    </>
  );
}
