import type { PlanMethodDto } from "@/lib/adaptation/v22/method-projection";
import { needLabels, targetLabel } from "@/lib/adaptation/presentation/copy";

/**
 * What the V2.2 method leaves open (ADR-046): the questions only the teacher can answer and the barriers the adaptation does not
 * remove. Read-only; a question or note the server withheld (it could reveal an answer) says so instead of showing it.
 */
export function MethodSummary({ method, targets }: { method: PlanMethodDto; targets: Record<string, string> }) {
  if (method.questions.length === 0 && method.barriers.length === 0) return null;
  return (
    <section aria-labelledby="method-summary-title" className="space-y-3 rounded-md border border-border p-4 text-sm">
      <h3 id="method-summary-title" className="text-base font-semibold">
        Lo que queda en tus manos
      </h3>
      {method.questions.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium">Preguntas para ti</p>
          <ul className="list-disc space-y-1 pl-5">
            {method.questions.map((q) => (
              <li key={q.id}>{q.text ?? "Hay una pregunta que no se muestra porque podría revelar una respuesta."}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {method.barriers.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium">Barreras que la adaptación no elimina</p>
          <ul className="list-disc space-y-1 pl-5">
            {method.barriers.map((b, i) => (
              <li key={`${b.target}-${i}`}>
                {targetLabel(b.target, targets)}
                {b.needs.length > 0 ? ` · ${needLabels(b.needs).join(" · ")}` : ""}
                {b.note ? `: ${b.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-muted-foreground">Las decisiones que esperan tu decisión empiezan sin marcar.</p>
    </section>
  );
}
