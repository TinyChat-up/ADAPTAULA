"use client";

import { SelectField, TextareaField } from "@/components/ui/fields";
import type { Block } from "@/lib/schemas/material-document";
import { editActivity, type EditorChanges } from "@/lib/editor/changes";

export function ActivityControls({ activities, selected, onSelect, changes, onChange }: {
  activities: Array<Extract<Block, { type: "activity" }>>; selected: string; onSelect: (id: string) => void;
  changes: EditorChanges; onChange: (value: EditorChanges) => void;
}) {
  const activity = activities.find((a) => a.id === selected);
  const edit = changes.activities.find((a) => a.blockId === selected);
  return <fieldset className="space-y-4">
    <legend className="mb-3 font-semibold">Actividad</legend>
    {activities.length ? <SelectField label="Elegir actividad" value={selected} onChange={(e) => onSelect(e.target.value)}>
      {activities.map((a, i) => <option key={a.id} value={a.id}>Actividad {a.label ?? i + 1}</option>)}
    </SelectField> : <p className="text-sm">Esta ficha no tiene actividades editables. Puedes ajustar su presentación.</p>}
    {activity ? <>
      <TextareaField label="Enunciado" rows={6} maxLength={3000} value={edit?.prompt ?? activity.prompt}
        hint="Conserva los datos y lo que debe resolver el alumnado. No añadas respuestas."
        onChange={(e) => onChange(editActivity(changes, selected, { prompt: e.target.value }))} />
      {activity.response.kind === "lines" ? <SelectField label="Líneas para responder" value={edit?.lines ?? activity.response.lines}
        hint="Si la actividad exige una extensión mínima, la ficha conservará ese espacio."
        onChange={(e) => onChange(editActivity(changes, selected, { lines: Number(e.target.value) }))}>
        {Array.from({ length: 40 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
      </SelectField> : activity.response.kind === "box" ? <SelectField label="Espacio para responder" value={edit?.box ?? activity.response.size}
        onChange={(e) => onChange(editActivity(changes, selected, { box: e.target.value as "small" | "medium" | "large" }))}>
        <option value="small">Pequeño</option><option value="medium">Mediano</option><option value="large">Grande</option>
      </SelectField> : <p className="text-sm text-muted-foreground">El formato de respuesta de esta actividad se conserva.</p>}
      <p className="text-sm text-muted-foreground">Se conservan los pasos, requisitos, opciones, tablas y figuras. Su edición llegará en otra entrega.</p>
    </> : null}
  </fieldset>;
}
