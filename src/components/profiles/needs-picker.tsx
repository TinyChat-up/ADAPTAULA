import { SelectField } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/layout";
import { PROFILE_AREAS, dimensionsOfArea, type ProfileAreaId } from "@/lib/profiles/areas";
import { PROFILE_PRESETS } from "@/lib/profiles/presets";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import { cn } from "@/lib/utils/cn";

export function PresetPicker({
  presetId,
  onSelect,
  onApply,
  hasConfiguration,
}: {
  presetId: string;
  onSelect: (id: string) => void;
  onApply: () => void;
  hasConfiguration: boolean;
}) {
  const preset = PROFILE_PRESETS.find((p) => p.id === presetId);
  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-semibold">Empezar desde un punto de partida</h3>
        <p className="text-sm text-muted-foreground">
          Opcional. Precarga unas necesidades funcionales que después puedes cambiar por completo. No representa ni guarda ningún diagnóstico.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <SelectField label="Punto de partida" value={presetId} onChange={(e) => onSelect(e.target.value)}>
            <option value="">Ninguno</option>
            {PROFILE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </SelectField>
        </div>
        <Button variant="secondary" onClick={onApply} disabled={!preset}>
          Aplicar
        </Button>
      </div>
      {preset ? (
        <p className="text-sm">
          {preset.description}
          {hasConfiguration ? <span className="text-muted-foreground"> Al aplicarlo se sustituye la configuración actual.</span> : null}
        </p>
      ) : null}
    </Card>
  );
}

export function AreaPicker({
  open,
  profile,
  onToggle,
}: {
  open: ReadonlySet<ProfileAreaId>;
  profile: FunctionalProfile;
  onToggle: (id: ProfileAreaId) => void;
}) {
  return (
    <div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PROFILE_AREAS.map((area) => {
          const selected = open.has(area.id);
          const active = dimensionsOfArea(area).filter((k) => (profile.supports[k] ?? "none") !== "none").length;
          return (
            <li key={area.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onToggle(area.id)}
                className={cn(
                  "h-full w-full rounded-card border p-4 text-left",
                  selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-surface hover:bg-background",
                )}
              >
                <span className="block font-medium">{area.label}</span>
                <span className="block text-sm text-muted-foreground">{area.description}</span>
                {active > 0 ? (
                  <span className="mt-2 block text-xs font-medium text-primary">
                    {active} {active === 1 ? "apoyo activo" : "apoyos activos"}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">Al quitar un área se restablecen sus ajustes.</p>
    </div>
  );
}
