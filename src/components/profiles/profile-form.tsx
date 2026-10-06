"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { AdvancedLimits } from "@/components/profiles/advanced-limits";
import { AreaControls } from "@/components/profiles/dimension-controls";
import { AreaPicker, PresetPicker } from "@/components/profiles/needs-picker";
import { ProfileSummaryPanel } from "@/components/profiles/profile-summary-panel";
import { LinkButton, Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/fields";
import { Alert } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import type { EducationCatalog } from "@/lib/profiles/catalog";
import { PROFILE_AREAS, type ProfileAreaId } from "@/lib/profiles/areas";
import { applyPreset, areasInUse, clearArea, compactProfile, setSupport } from "@/lib/profiles/draft";
import { findPreset } from "@/lib/profiles/presets";
import { summarizeProfile } from "@/lib/profiles/summary";
import { DISPLAY_NAME_MAX } from "@/lib/schemas/learner-profile";
import { emptyFunctionalProfile, type FunctionalProfile } from "@/lib/schemas/functional-profile";

export interface ProfileFormValues {
  display_name: string;
  stage_slug: string;
  grade_slug: string;
  functional_profile: FunctionalProfile;
}

export type SubmitResult =
  | { ok: false; code: string; message: string; fieldErrors?: Partial<Record<string, string>> }
  | undefined;

export const EMPTY_VALUES: ProfileFormValues = {
  display_name: "",
  stage_slug: "",
  grade_slug: "",
  functional_profile: emptyFunctionalProfile(),
};

export function ProfileForm({
  initial = EMPTY_VALUES,
  catalog,
  submitLabel,
  onSubmit,
}: {
  initial?: ProfileFormValues;
  catalog: EducationCatalog;
  submitLabel: string;
  onSubmit: (input: ProfileFormValues) => Promise<SubmitResult>;
}) {
  const [name, setName] = useState(initial.display_name);
  const [stage, setStage] = useState(initial.stage_slug);
  const [grade, setGrade] = useState(initial.grade_slug);
  const [profile, setProfile] = useState<FunctionalProfile>(initial.functional_profile);
  const [openAreas, setOpenAreas] = useState<Set<ProfileAreaId>>(() => new Set(areasInUse(initial.functional_profile)));
  const [presetId, setPresetId] = useState("");
  const [result, setResult] = useState<SubmitResult>(undefined);
  const [pending, startTransition] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);

  const summary = useMemo(() => summarizeProfile(profile), [profile]);
  const gradesForStage = catalog.grades.filter((g) => g.stage_slug === stage);
  const errors = result?.fieldErrors ?? {};
  const hasConfiguration = !summary.isEmpty;

  function toggleArea(id: ProfileAreaId) {
    const next = new Set(openAreas);
    if (next.has(id)) {
      next.delete(id);
      setProfile((p) => clearArea(p, id));
    } else {
      next.add(id);
    }
    setOpenAreas(next);
  }

  function applySelectedPreset() {
    const preset = findPreset(presetId);
    if (!preset) return;
    const next = applyPreset(preset);
    setProfile(next);
    setOpenAreas(new Set(areasInUse(next)));
  }

  function submit() {
    startTransition(async () => {
      const outcome = await onSubmit({
        display_name: name,
        stage_slug: stage,
        grade_slug: grade,
        functional_profile: compactProfile(profile),
      });
      setResult(outcome);
      if (outcome) queueMicrotask(() => errorRef.current?.focus());
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid gap-8 lg:grid-cols-[1fr_20rem]"
      noValidate
    >
      <div className="space-y-10">
        {result ? (
          <div ref={errorRef} tabIndex={-1}>
            <Alert tone="danger">{result.message}</Alert>
          </div>
        ) : null}

        <section aria-labelledby="info-titulo" className="space-y-4">
          <h2 id="info-titulo" className="text-xl font-semibold">
            Información
          </h2>
          <Card className="space-y-5">
            <TextField
              label="Alias o iniciales"
              hint="Puedes utilizar un alias o iniciales. No necesitamos el nombre completo."
              value={name}
              maxLength={DISPLAY_NAME_MAX}
              autoComplete="off"
              required
              error={errors.display_name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <SelectField
                label="Etapa"
                value={stage}
                required
                error={errors.stage_slug}
                onChange={(e) => {
                  setStage(e.target.value);
                  setGrade("");
                }}
              >
                <option value="">Elige una etapa</option>
                {catalog.stages.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Curso"
                value={grade}
                required
                disabled={!stage}
                error={errors.grade_slug}
                onChange={(e) => setGrade(e.target.value)}
              >
                <option value="">{stage ? "Elige un curso" : "Elige primero la etapa"}</option>
                {gradesForStage.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.name}
                  </option>
                ))}
              </SelectField>
            </div>
          </Card>
        </section>

        <section aria-labelledby="apoyo-titulo" className="space-y-4">
          <div>
            <h2 id="apoyo-titulo" className="text-xl font-semibold">
              ¿En qué necesita apoyo?
            </h2>
            <p className="text-muted-foreground">Elige las áreas que quieras ajustar. Solo verás los controles de las que selecciones.</p>
          </div>
          <PresetPicker presetId={presetId} onSelect={setPresetId} onApply={applySelectedPreset} hasConfiguration={hasConfiguration} />
          <AreaPicker open={openAreas} profile={profile} onToggle={toggleArea} />
          {PROFILE_AREAS.filter((a) => openAreas.has(a.id)).map((area) => (
            <AreaControls key={area.id} area={area} profile={profile} onChange={(key, level) => setProfile((p) => setSupport(p, key, level))} />
          ))}
          <AdvancedLimits profile={profile} onChange={(next) => setProfile((p) => compactProfile({ ...p, ...next }))} />
        </section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <LinkButton href="/app/alumnos" variant="ghost">
            Cancelar
          </LinkButton>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Guardando…" : submitLabel}
          </Button>
        </div>
      </div>

      <aside aria-label="Resumen del perfil" className="lg:sticky lg:top-6 lg:self-start">
        <ProfileSummaryPanel summary={summary} />
        <p className="mt-3 text-xs text-muted-foreground">
          Resumen generado a partir de tus ajustes. Nunca incluye el alias.{" "}
          <Link href="/privacidad" className="underline underline-offset-2">
            Privacidad
          </Link>
        </p>
      </aside>
    </form>
  );
}
