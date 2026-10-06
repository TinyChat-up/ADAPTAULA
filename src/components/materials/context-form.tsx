"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/fields";
import { Alert } from "@/components/ui/feedback";
import { stageOfGrade, type ContextField, type ResolvedContext } from "@/lib/analysis/context";

interface Option {
  slug: string;
  name: string;
}

export interface ContextFormProps {
  initial: { title: string; stage: string; grade: string; subject: string; topic: string };
  provenance: ResolvedContext;
  stages: Option[];
  grades: Array<Option & { stage_slug: string }>;
  subjects: Array<Option & { stage_slugs: string[] }>;
  onSave: (input: unknown) => Promise<{ ok: true } | { ok: false; message: string; fieldErrors?: Partial<Record<string, string>> }>;
}

function Provenance({ field, provenance }: { field: ContextField; provenance: ResolvedContext }) {
  const source = provenance[field].source;
  if (source === "none") return null;
  return <span className="ml-2 text-xs font-normal text-muted-foreground">{source === "teacher" ? "Confirmado por ti" : "Detectado automáticamente"}</span>;
}

export function ContextForm({ initial, provenance, stages, grades, subjects, onSave }: ContextFormProps) {
  const [title, setTitle] = useState(initial.title);
  const [stage, setStage] = useState(initial.stage);
  const [grade, setGrade] = useState(initial.grade);
  const [subject, setSubject] = useState(initial.subject);
  const [topic, setTopic] = useState(initial.topic);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [pending, startTransition] = useTransition();

  const visibleGrades = grades.filter((g) => !stage || g.stage_slug === stage);
  const visibleSubjects = subjects.filter((s) => !stage || s.stage_slugs.includes(stage));

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await onSave({ title, stage_slug: stage, grade_slug: grade, subject_slug: subject, topic });
      if (result.ok) {
        setErrors({});
        setMessage({ tone: "success", text: "Datos guardados. Tus correcciones prevalecen sobre lo detectado." });
      } else {
        setErrors(result.fieldErrors ?? {});
        setMessage({ tone: "danger", text: result.message });
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-4"
      noValidate
    >
      <p className="text-sm text-muted-foreground">Corrige lo que no sea correcto. Lo que confirmes aquí tendrá prioridad sobre lo que ha detectado Adaptaula.</p>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <TextField label={<>Título<Provenance field="title" provenance={provenance} /></>} value={title} maxLength={200} error={errors.title} onChange={(e) => setTitle(e.target.value)} />
      <SelectField
        label={<>Etapa<Provenance field="stage" provenance={provenance} /></>}
        value={stage}
        error={errors.stage_slug}
        onChange={(e) => {
          setStage(e.target.value);
          if (grade && e.target.value && stageOfGrade(grade) !== e.target.value) setGrade("");
        }}
      >
        <option value="">Sin indicar</option>
        {stages.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name}
          </option>
        ))}
      </SelectField>
      <SelectField label={<>Curso<Provenance field="grade" provenance={provenance} /></>} value={grade} error={errors.grade_slug} onChange={(e) => setGrade(e.target.value)}>
        <option value="">Sin indicar</option>
        {visibleGrades.map((g) => (
          <option key={g.slug} value={g.slug}>
            {g.name}
          </option>
        ))}
      </SelectField>
      <SelectField label={<>Asignatura<Provenance field="subject" provenance={provenance} /></>} value={subject} error={errors.subject_slug} onChange={(e) => setSubject(e.target.value)}>
        <option value="">Sin indicar</option>
        {visibleSubjects.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name}
          </option>
        ))}
      </SelectField>
      <TextField label={<>Tema<Provenance field="topic" provenance={provenance} /></>} value={topic} maxLength={200} error={errors.topic} onChange={(e) => setTopic(e.target.value)} />
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar datos"}
      </Button>
    </form>
  );
}
