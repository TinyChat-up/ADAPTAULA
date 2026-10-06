import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/layout";
import type { ProfileSummary } from "@/lib/profiles/summary";

export function ProfileSummaryPanel({ summary }: { summary: ProfileSummary }) {
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold">
        <Sparkles aria-hidden className="size-4 text-accent" />
        Así se aplicará
      </h2>
      <p className="text-sm text-muted-foreground">{summary.intro}</p>
      {summary.isEmpty ? null : (
        <ul className="space-y-1.5 text-sm">
          {summary.lines.map((line) => (
            <li key={line.text} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>
                {line.text}
                {line.level ? <span className="text-muted-foreground"> ({line.level})</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
