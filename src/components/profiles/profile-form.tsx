"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { WorkspaceDisclosure } from "@/components/workspace/disclosure";
import { AdvancedLimits } from "@/components/profiles/advanced-limits";
import { AreaControls } from "@/components/profiles/dimension-controls";
import { AreaPicker, PresetPicker } from "@/components/profiles/needs-picker";
import { ProfileSummaryPanel } from "@/components/profiles/profile-summary-panel";
import { StartingPointCards } from "@/components/profiles/starting-point-cards";
import { LearningObservationsPicker } from "@/components/profiles/learning-observations";
import { ProfileBasics } from "@/components/profiles/profile-basics";
import { PedagogicalAreas, PedagogicalPreferences } from "@/components/profiles/pedagogical-fields";
import { emptyPedagogicalProfile, type PedagogicalProfile } from "@/lib/schemas/pedagogical-profile";
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

function ProfileDisclosure({ collapsed, title, children }: { collapsed: boolean; title: string; children: ReactNode }) {
  return collapsed ? <WorkspaceDisclosure title={title}>{children}</WorkspaceDisclosure> : children;
}

export function ProfileForm({
  initial,
  catalog,
  submitLabel,
  onSubmit,
}: {
  initial?: ProfileFormValues;
  catalog: EducationCatalog;
  submitLabel: string;
  onSubmit: (input: ProfileFormValues) => Promise<SubmitResult>;
}) {
  const creating = initial === undefined;
  const base = initial ?? EMPTY_VALUES;
  const [name, setName] = useState(base.display_name);
  const [stage, setStage] = useState(base.stage_slug);
  const [grade, setGrade] = useState(base.grade_slug);
  const [profile, setProfile] = useState<FunctionalProfile>(base.functional_profile);
  const [openAreas, setOpenAreas] = useState<Set<ProfileAreaId>>(() => new Set(areasInUse(base.functional_profile)));
  const [presetId, setPresetId] = useState("");
  const [points, setPoints] = useState<StartingPointId[]>(() => pointsInUse(base.functional_profile));
  const [cardsPending, setCardsPending] = useState(false);
  const [history, setHistory] = useState<FunctionalProfile[]>([]);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<SubmitResult>(undefined);
  const [pending, startTransition] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);

  const summary = useMemo(() => summarizeProfile(profile), [profile]);
  const errors = result?.fieldErrors ?? {};
  const hasConfiguration = !summary.isEmpty;
  const showSummary = !creating || hasConfiguration || summary.learningAreas > 0 || summary.supportedShortAnswers ||
    summary.strengths.length > 0 || summary.barriers.length > 0 || summary.notNeeded.length > 0;
  const pedagogy = profile.pedagogy ?? emptyPedagogicalProfile();

  useEffect(() => {
    if (result) errorRef.current?.focus();
  }, [result]);

  function changeProfile(next: FunctionalProfile) {
    setHistory((past) => [...past.slice(-19), profile]);
    setProfile(next);
  }

  function changePedagogy(pedagogy: PedagogicalProfile) {
    changeProfile({ ...profile, schema_version: 3, pedagogy });
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

  function addQuickSupport(id: StartingPointId) {
    const next = addPresets(profile, [presetForPoint(id)]);
    changeProfile(next);
    setOpenAreas(new Set(areasInUse(next)));
    setNotice(pointsInUse(next).includes(id) ? "Apoyo añadido. Puedes deshacer el cambio." : "Se han respetado tus ajustes anteriores.");
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
      return;
    }
    startTransition(async () => {
      const outcome = await onSubmit({
        display_name: name,
        stage_slug: stage,
        grade_slug: grade,
        functional_profile: compactProfile(profile),
        ...(base.expected_updated_at ? { expected_updated_at: base.expected_updated_at } : {}),
      });
      setResult(outcome);
    });
  }

  const save = (
    <div className="flex flex-wrap items-center gap-2">
      <Button id="guardar-perfil" className="scroll-mt-24" type="submit" size="lg" disabled={pending}>
        {pending ? "Guardando…" : submitLabel}
      </Button>
      <LinkButton href="/app/alumnos" variant="ghost">
        Cancelar
      </LinkButton>
    </div>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid min-w-0 gap-8 [overflow-wrap:anywhere] xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"
      noValidate
    >
      <div className={cn("min-w-0", creating ? "space-y-5" : "space-y-8")}>
        {result ? (
          <div ref={errorRef} tabIndex={-1}>
            <Alert tone="danger">{result.message}</Alert>
          </div>
        ) : null}

        <ProfileBasics compact={creating} name={name} stage={stage} grade={grade} catalog={catalog} errors={errors} onName={setName} onStage={(value) => { setStage(value); setGrade(""); }} onGrade={setGrade} />
        {creating ? (
          <div className="space-y-2">
            {save}
            <p className="text-sm text-muted-foreground">Puedes añadir o cambiar detalles más adelante.</p>
          </div>
        ) : null}

        <section aria-labelledby={creating ? "perfil-opcional" : undefined} className={creating ? "group/optional space-y-2" : "space-y-8"}>
          {creating ? <h2 id="perfil-opcional" className="text-lg font-semibold">Información opcional</h2> : null}
          <PedagogicalAreas value={pedagogy} catalog={catalog} onChange={changePedagogy} compact={creating} />
          <ProfileDisclosure collapsed={creating} title="Apoyos que le funcionan">
            <section aria-labelledby="apoyo-titulo" className="space-y-4">
              <div>
                <h2 id="apoyo-titulo" className={creating ? "sr-only" : "text-xl font-semibold"}>
                  ¿Qué apoyos le funcionan?
                </h2>
                <p className="text-muted-foreground">Elige apoyos que le ayuden a acceder a la tarea o a mostrar lo que sabe.</p>
              </div>
              {areasInUse(base.functional_profile).length > 0 ? <p className="text-sm text-muted-foreground">Tus apoyos guardados están en el resumen. Solo se marcan las tarjetas cuya propuesta completa ya coincide con ellos; no necesitas volver a aplicarlas.</p> : null}
              {creating ? (
                <StartingPointCards selected={pointsInUse(profile)} onQuickAdd={addQuickSupport} />
              ) : (
                <StartingPointCards selected={points} onSelect={(id) => {
                  const next = points.includes(id) ? points.filter((p) => p !== id) : [...points, id];
                  setPoints(next);
                  setCardsPending(next.length > 0);
                }} onAdd={() => applyPoints()} onReplace={() => applyPoints(true)} />
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" disabled={!history.length} onClick={() => { const previous = history.at(-1); if (previous) { setProfile(previous); setHistory(history.slice(0, -1)); setOpenAreas(new Set(areasInUse(previous))); setNotice("Último cambio deshecho. Las tarjetas son propuestas; revisa los apoyos del resumen."); } }}>Deshacer último cambio</Button>
                <p role="status" className="text-sm text-muted-foreground">{notice}</p>
              </div>
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
            </section>
          </ProfileDisclosure>
          <ProfileDisclosure collapsed={creating} title="Fortalezas y barreras">
            <section aria-labelledby="observaciones-titulo" className="space-y-4">
              <h2 id="observaciones-titulo" className={creating ? "sr-only" : "text-xl font-semibold"}>Fortalezas y barreras observadas</h2>
              <LearningObservationsPicker value={profile.observations ?? { strengths: [], barriers: [] }} onChange={(observations) => changeProfile({ ...profile, schema_version: profile.schema_version === 3 ? 3 : 2, observations })} onAddSuggestions={(keys) => { const next = addPresets(profile, [{ id: "suggestions", label: "Sugerencias", description: "", supports: Object.fromEntries(keys.map((key) => [key, "medium" as const])) }]); changeProfile(next); setOpenAreas(new Set(areasInUse(next))); setNotice("Sugerencias añadidas por tu elección. Puedes ajustar su frecuencia o deshacer el cambio."); }} />
              {base.functional_profile.schema_version === 1 ? <p className="text-sm text-muted-foreground">Los apoyos del perfil anterior se conservan. No hemos inferido fortalezas, barreras ni competencias.</p> : null}
            </section>
          </ProfileDisclosure>
          <ProfileDisclosure collapsed={creating} title="Formas de responder">
            <PedagogicalPreferences value={pedagogy} onChange={changePedagogy} />
          </ProfileDisclosure>
          {creating ? <a href="#guardar-perfil" className="hidden min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2 group-has-[details[open]]/optional:inline-flex">Ir a guardar el perfil</a> : null}
        </section>
      </div>

      {showSummary ? (
        <aside aria-label="Resumen del perfil" className="min-w-0 xl:sticky xl:top-6 xl:self-start">
          <ProfileSummaryPanel summary={summary} />
          <p className="mt-3 text-xs text-muted-foreground">
            Resumen generado a partir de tus ajustes. Nunca incluye el alias.{" "}
            <Link href="/privacidad" className="underline underline-offset-2">
              Privacidad
            </Link>
          </p>
        </aside>
      ) : null}
      {creating ? null : <div className="xl:col-start-1">{save}</div>}
    </form>
  );
}
