"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { AdvancedLimits } from "@/components/profiles/advanced-limits";
import { AreaControls } from "@/components/profiles/dimension-controls";
import { AreaPicker, PresetPicker } from "@/components/profiles/needs-picker";
import { ProfileSummaryPanel } from "@/components/profiles/profile-summary-panel";
import { StartingPointCards } from "@/components/profiles/starting-point-cards";
import { LearningObservationsPicker } from "@/components/profiles/learning-observations";
import { ProfileBasics } from "@/components/profiles/profile-basics";
import { LinkButton, Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import type { EducationCatalog } from "@/lib/profiles/catalog";
import { PROFILE_AREAS, type ProfileAreaId } from "@/lib/profiles/areas";
import { addPresets, areasInUse, compactProfile, replaceSupports, setSupport } from "@/lib/profiles/draft";
import { pointsInUse, presetForPoint, type StartingPointId } from "@/lib/profiles/starting-points";
import { findPreset } from "@/lib/profiles/presets";
import { summarizeProfile } from "@/lib/profiles/summary";
import { emptyFunctionalProfile, type FunctionalProfile } from "@/lib/schemas/functional-profile";

export interface ProfileFormValues {
  display_name: string;
  stage_slug: string;
  grade_slug: string;
  functional_profile: FunctionalProfile;
  expected_updated_at?: string;
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
  const [points, setPoints] = useState<StartingPointId[]>(() => pointsInUse(initial.functional_profile));
  const [cardsPending, setCardsPending] = useState(false);
  const [history, setHistory] = useState<FunctionalProfile[]>([]);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<SubmitResult>(undefined);
  const [pending, startTransition] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);

  const summary = useMemo(() => summarizeProfile(profile), [profile]);
  const errors = result?.fieldErrors ?? {};
  const hasConfiguration = !summary.isEmpty;

  function changeProfile(next: FunctionalProfile) {
    setHistory((past) => [...past.slice(-19), profile]);
    setProfile(next);
  }

  function applyPoints(replace = false) {
    const presets = points.map(presetForPoint);
    const next = replace ? replaceSupports(profile, presets) : addPresets(profile, presets);
    changeProfile(next);
    setOpenAreas(new Set(areasInUse(next)));
    setCardsPending(false);
    setResult(undefined);
    setNotice(replace ? "Configuración sustituida. Puedes deshacer el cambio." : "Apoyos añadidos. Conservamos tus ajustes y lo marcado como no necesario.");
  }

  function toggleArea(id: ProfileAreaId) {
    const next = new Set(openAreas);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setOpenAreas(next);
  }

  function applySelectedPreset() {
    const preset = findPreset(presetId);
    if (!preset) return;
    const next = addPresets(profile, [preset]);
    changeProfile(next);
    setOpenAreas(new Set(areasInUse(next)));
    setNotice("Punto de partida añadido sin borrar los apoyos anteriores.");
  }

  function submit() {
    if (cardsPending) {
      setResult({ ok: false, code: "pending_supports", message: "Pulsa «Añadir estos apoyos» para aplicar las tarjetas seleccionadas o desmárcalas antes de guardar." });
      queueMicrotask(() => errorRef.current?.focus());
      return;
    }
    startTransition(async () => {
      const outcome = await onSubmit({
        display_name: name,
        stage_slug: stage,
        grade_slug: grade,
        functional_profile: compactProfile(profile),
        ...(initial.expected_updated_at ? { expected_updated_at: initial.expected_updated_at } : {}),
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
      className="grid min-w-0 gap-8 [overflow-wrap:anywhere] xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"
      noValidate
    >
      <div className="min-w-0 space-y-8">
        {result ? (
          <div ref={errorRef} tabIndex={-1}>
            <Alert tone="danger">{result.message}</Alert>
          </div>
        ) : null}

        <ProfileBasics name={name} stage={stage} grade={grade} catalog={catalog} errors={errors} onName={setName} onStage={(value) => { setStage(value); setGrade(""); }} onGrade={setGrade} />
        <p className="text-sm text-muted-foreground">Puedes completar lo demás después. <a href="#guardar-perfil" className="font-medium text-primary underline underline-offset-2">Ir a guardar el perfil</a></p>

        <section aria-labelledby="apoyo-titulo" className="space-y-4">
          <div>
            <h2 id="apoyo-titulo" className="text-xl font-semibold">
              02 · ¿Qué puede ayudarle a aprender?
            </h2>
            <p className="text-muted-foreground">Imágenes para comprender y acceso visual son apoyos distintos. Puedes combinarlos con una página despejada.</p>
          </div>
          {areasInUse(initial.functional_profile).length > 0 ? <p className="text-sm text-muted-foreground">Tus apoyos guardados están en el resumen. Solo se marcan las tarjetas cuya propuesta completa ya coincide con ellos; no necesitas volver a aplicarlas.</p> : null}
          <StartingPointCards selected={points} onSelect={(id) => { const next = points.includes(id) ? points.filter((p) => p !== id) : [...points, id]; setPoints(next); setCardsPending(next.length > 0); }} onAdd={() => applyPoints()} onReplace={() => applyPoints(true)} />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" disabled={!history.length} onClick={() => { const previous = history.at(-1); if (previous) { setProfile(previous); setHistory(history.slice(0, -1)); setOpenAreas(new Set(areasInUse(previous))); setNotice("Último cambio deshecho. Las tarjetas son propuestas; revisa los apoyos del resumen."); } }}>Deshacer último cambio</Button>
            <p role="status" className="text-sm text-muted-foreground">{notice}</p>
          </div>
        </section>

        <section aria-labelledby="observaciones-titulo" className="space-y-4">
          <h2 id="observaciones-titulo" className="text-xl font-semibold">03 · Lo que observas en clase</h2>
          <LearningObservationsPicker value={profile.observations ?? { strengths: [], barriers: [] }} onChange={(observations) => changeProfile({ ...profile, schema_version: 2, observations })} onAddSuggestions={(keys) => { const next = addPresets(profile, [{ id: "suggestions", label: "Sugerencias", description: "", supports: Object.fromEntries(keys.map((key) => [key, "medium" as const])) }]); changeProfile(next); setOpenAreas(new Set(areasInUse(next))); setNotice("Sugerencias añadidas por tu elección. Puedes ajustar su frecuencia o deshacer el cambio."); }} />
          <details data-profile-advanced className="rounded-card border border-border p-4">
            <summary className="min-h-9 cursor-pointer font-medium">Personalizar más</summary>
            <div className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">La frecuencia indica cuánto ayuda un apoyo, no capacidad ni nivel curricular. «No indicado» es diferente de «No necesita este apoyo».</p>
              <PresetPicker presetId={presetId} onSelect={setPresetId} onApply={applySelectedPreset} hasConfiguration={hasConfiguration} />
              <details className="rounded-card border border-border p-4">
                <summary className="min-h-9 cursor-pointer font-medium">Elegir otras áreas de apoyo</summary>
                <div className="mt-4"><AreaPicker open={openAreas} profile={profile} onToggle={toggleArea} /></div>
              </details>
              {PROFILE_AREAS.filter((a) => openAreas.has(a.id)).map((area) => (
                <AreaControls key={area.id} area={area} profile={profile} onChange={(key, level) => changeProfile(setSupport(profile, key, level))} />
              ))}
              <AdvancedLimits profile={profile} onChange={(next) => changeProfile(compactProfile({ ...profile, ...next }))} />
            </div>
          </details>
          {initial.functional_profile.schema_version === 1 ? <p className="text-sm text-muted-foreground">Los apoyos del perfil anterior se conservan. No hemos inferido fortalezas, barreras ni competencias.</p> : null}
        </section>

        <div id="guardar-perfil" className="flex scroll-mt-24 flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <LinkButton href="/app/alumnos" variant="ghost">
            Cancelar
          </LinkButton>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Guardando…" : submitLabel}
          </Button>
        </div>
      </div>

      <aside aria-label="Resumen del perfil" className="min-w-0 xl:sticky xl:top-6 xl:self-start">
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
