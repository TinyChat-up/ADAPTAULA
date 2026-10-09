import { Alert } from "@/components/ui/feedback";
import type { RenderValidation } from "@/lib/render/model";
import { MATERIAL_RENDERER_VERSION } from "@/lib/render/version";

const STATUS_COPY = {
  renderable: "La ficha se puede mostrar completa.",
  renderable_with_warnings: "La ficha se puede mostrar, con avisos de presentación.",
  not_renderable: "La ficha no se puede mostrar completa todavía.",
} as const;

/**
 * Teacher-only layer, OUTSIDE the sheet (hidden in print, never in the student's view): the version, what the presentation
 * could not do and which pedagogical observations the review left. No prompts, reasoning, profile or inferred answers.
 */
export function TeacherPanel({ validation, version, observations }: { validation: RenderValidation; version: number; observations: string[] }) {
  const attention = validation.issues.filter((i) => i.severity !== "info");
  const notes = validation.issues.filter((i) => i.severity === "info");
  return (
    <aside className="ms-teacher space-y-4" aria-label="Información para la docente">
      <Alert tone={validation.status === "not_renderable" ? "danger" : validation.status === "renderable_with_warnings" ? "warning" : "success"} title={STATUS_COPY[validation.status]}>
        <p className="text-sm text-muted-foreground">
          Versión {version} · {MATERIAL_RENDERER_VERSION}
        </p>
      </Alert>
      {attention.length > 0 ? (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Avisos de presentación</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {attention.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {observations.length > 0 ? (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Observaciones de la revisión (no impiden usar la ficha)</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {observations.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {notes.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">Detalles de la presentación</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {notes.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </aside>
  );
}
