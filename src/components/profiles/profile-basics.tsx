import { Card } from "@/components/ui/layout";
import { SelectField, TextField } from "@/components/ui/fields";
import type { EducationCatalog } from "@/lib/profiles/catalog";
import { DISPLAY_NAME_MAX } from "@/lib/schemas/learner-profile";

export function ProfileBasics({ name, stage, grade, catalog, errors, onName, onStage, onGrade }: {
  name: string; stage: string; grade: string; catalog: EducationCatalog; errors: Partial<Record<string, string>>;
  onName: (value: string) => void; onStage: (value: string) => void; onGrade: (value: string) => void;
}) {
  return <section aria-labelledby="info-titulo" className="space-y-4">
    <h2 id="info-titulo" className="text-xl font-semibold">01 · Información básica</h2>
    <Card className="space-y-5">
      <TextField label="Alias o iniciales" hint="Puedes utilizar un alias o iniciales. No necesitamos el nombre completo ni ningún dato médico." value={name} maxLength={DISPLAY_NAME_MAX} autoComplete="off" required error={errors.display_name} onChange={(e) => onName(e.target.value)} />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label="Etapa" value={stage} required error={errors.stage_slug} onChange={(e) => onStage(e.target.value)}>
          <option value="">Elige una etapa</option>{catalog.stages.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
        </SelectField>
        <SelectField label="Curso" value={grade} required disabled={!stage} error={errors.grade_slug} onChange={(e) => onGrade(e.target.value)}>
          <option value="">{stage ? "Elige un curso" : "Elige primero la etapa"}</option>{catalog.grades.filter((g) => g.stage_slug === stage).map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
        </SelectField>
      </div>
      <p className="text-sm text-muted-foreground">Curso de escolarización. La intensidad del apoyo no determina su competencia curricular.</p>
    </Card>
  </section>;
}
