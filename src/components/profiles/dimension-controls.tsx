import { Card } from "@/components/ui/layout";
import { cn } from "@/lib/utils/cn";
import { dimensionsOfArea, type ProfileArea } from "@/lib/profiles/areas";
import { DIMENSION_COPY, LEVEL_OPTIONS } from "@/lib/profiles/copy";
import type { DimensionKey, FunctionalProfile, SupportLevel } from "@/lib/schemas/functional-profile";

function LevelControl({ dimension, value, onChange }: { dimension: DimensionKey; value: SupportLevel; onChange: (level: SupportLevel) => void }) {
  const copy = DIMENSION_COPY[dimension];
  const labelId = `label-${dimension}`;
  const hintId = `hint-${dimension}`;
  return (
    <div className="grid gap-2 py-3 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-6">
      <div>
        <p id={labelId} className="text-sm font-medium">
          {copy.control}
        </p>
        {copy.hint ? (
          <p id={hintId} className="text-xs text-muted-foreground">
            {copy.hint}
          </p>
        ) : null}
      </div>
      <div role="radiogroup" aria-labelledby={labelId} aria-describedby={copy.hint ? hintId : undefined} className="flex flex-wrap gap-1.5">
        {LEVEL_OPTIONS.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex min-h-9 cursor-pointer items-center rounded-control border border-border bg-surface px-3 text-sm has-[:checked]:font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
              o.value === "none"
                ? "has-[:checked]:border-foreground/40 has-[:checked]:bg-foreground/5"
                : "has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground",
            )}
          >
            <input
              type="radio"
              name={`dim-${dimension}`}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function AreaControls({
  area,
  profile,
  onChange,
}: {
  area: ProfileArea;
  profile: FunctionalProfile;
  onChange: (dimension: DimensionKey, level: SupportLevel) => void;
}) {
  return (
    <Card>
      <h3 className="text-lg font-semibold">{area.label}</h3>
      <div className="mt-2 divide-y divide-border">
        {dimensionsOfArea(area).map((key) => (
          <LevelControl key={key} dimension={key} value={profile.supports[key] ?? "none"} onChange={(level) => onChange(key, level)} />
        ))}
      </div>
    </Card>
  );
}
