"use client";

import { SelectField } from "@/components/ui/fields";
import type { Presentation } from "@/lib/schemas/adaptation-context";
import type { EditorChanges } from "@/lib/editor/changes";

export function AppearanceControls({ presentation, changes, onChange }: { presentation: Presentation; changes: EditorChanges; onChange: (value: EditorChanges) => void }) {
  const set = (patch: EditorChanges["presentation"]) => onChange({ ...changes, presentation: { ...changes.presentation, ...patch } });
  return <fieldset className="space-y-4">
    <legend className="mb-3 font-semibold">Presentación</legend>
    <SelectField label="Tamaño de letra" value={presentation.font_scale} onChange={(e) => set({ font_scale: Number(e.target.value) as Presentation["font_scale"] })}>
      <option value="1">Habitual</option><option value="1.15">Un poco mayor</option><option value="1.3">Grande</option><option value="1.5">Muy grande</option>
    </SelectField>
    <SelectField label="Separación entre líneas" value={presentation.line_spacing} onChange={(e) => set({ line_spacing: e.target.value as Presentation["line_spacing"] })}>
      <option value="normal">Habitual</option><option value="relaxed">Amplia</option><option value="loose">Muy amplia</option>
    </SelectField>
    <SelectField label="Separación entre actividades" value={presentation.spacing} onChange={(e) => set({ spacing: e.target.value as Presentation["spacing"] })}>
      <option value="normal">Habitual</option><option value="wide">Amplia</option>
    </SelectField>
    <SelectField label="Contraste" value={presentation.contrast} onChange={(e) => set({ contrast: e.target.value as Presentation["contrast"] })}>
      <option value="normal">Habitual</option><option value="high">Alto</option>
    </SelectField>
  </fieldset>;
}
