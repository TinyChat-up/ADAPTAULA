import { z } from "zod";

/**
 * Phase III (experimental, NOT production): contracts for evaluating whether an adaptation keeps what an activity teaches.
 *
 *   ReferenceSheet  what the ORIGINAL sheet asks and what must survive (objective, data, figures, answers that must not appear,
 *                   barriers, admissible and unacceptable changes). Used only to SCORE.
 *   AdaptedSheet    an adaptation to be scored (here produced by controlled scripts, never from the reference's answers).
 *
 * A reference is a synthetic provisional proposal until a teacher reviews it; nothing in code can mark it as reviewed or
 * approved (`validation` must carry the teacher's own review record, see `TeacherValidationSchema`).
 */

export const VALIDATION_STATES = ["sintetica_provisional", "revisada_docente", "aprobada_docente"] as const;

/** A teacher's review is a record the teacher produces; code only reads it. */
export const TeacherValidationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("sintetica_provisional"), note: z.string().max(300) }),
  z.object({
    status: z.enum(["revisada_docente", "aprobada_docente"]),
    /** Role only, never a name. */
    reviewer: z.literal("docente"),
    reviewedAt: z.string().datetime({ offset: true }),
    /** sha-256 of the reference file version the teacher reviewed: a later edit invalidates the review. */
    referenceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    comments: z.string().max(2000),
  }),
]);

/** Cognitive operation an activity evaluates; an adaptation may change access, not this. */
export const OPERATIONS = ["identificar", "representar", "comparar", "justificar", "calcular_varios_pasos", "seleccionar_datos", "convertir_unidades",
  "localizar_informacion", "ordenar", "inferir", "interpretar_expresion", "clasificar", "producir_formas", "deducir", "relacionar_funcion", "planificar_ruta"] as const;
export type Operation = (typeof OPERATIONS)[number];

/** Facts of a figure that an adaptation must reproduce exactly (partitions, labels → parts, positions, arrows…). */
export const FigureFactsSchema = z.record(z.string().min(1).max(40), z.union([z.string().max(80), z.number(), z.boolean()]));

export const ReferenceFigureSchema = z.object({
  id: z.string().regex(/^fig_[a-z0-9_]{1,30}$/),
  kind: z.string().min(1).max(40),
  activityIds: z.array(z.string()).min(1),
  facts: FigureFactsSchema,
  /** Facts that are the student's work (an empty bar to shade, an unlabelled arrow): must stay unresolved. */
  unresolved: z.array(z.string()).default([]),
});

export const ReferenceActivitySchema = z.object({
  id: z.string().regex(/^act_[0-9]{1,3}$/),
  number: z.string().max(5),
  instruction: z.string().min(3),
  required: z.boolean(),
  operations: z.array(z.enum(OPERATIONS)).min(1),
  /** Words that carry each operation in the student text (at least one must remain): "explica", "por qué", "justifica"… */
  operationCues: z.array(z.string()).default([]),
  /** Data that must survive verbatim or in an equivalent form: numbers, units, names, relation words. */
  data: z.object({
    numbers: z.array(z.string()).default([]),
    units: z.array(z.string()).default([]),
    names: z.array(z.string()).default([]),
    relations: z.array(z.array(z.string()).min(1)).default([]),
    /** Ordered items whose order IS the task (e.g. events to number); the printed order must not change. */
    sequence: z.array(z.string()).default([]),
    options: z.array(z.string()).default([]),
  }).default({ numbers: [], units: [], names: [], relations: [], sequence: [], options: [] }),
});

export const AnswerSchema = z.object({
  activityId: z.string(),
  value: z.string(),
  /** Patterns (case/accent-insensitive regex sources) whose presence in student-facing text reveals this answer. */
  leakPatterns: z.array(z.string()).default([]),
});

export const ReferenceSheetSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,60}$/),
  /** sha-256 of the original file this reference describes (outside Git). */
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  split: z.enum(["development", "holdout"]),
  subject: z.string(),
  grade: z.string(),
  activityType: z.enum(["comprension_lectora", "numeracion_calculo", "fracciones", "ciencias", "esquema_etiquetado", "geometria", "gramatica", "plano_coordenadas"]),
  objective: z.string().min(10),
  /** Texts that are content of the task (a story, a problem statement): key facts that must survive. */
  sourceTexts: z.array(z.object({ id: z.string(), keyFacts: z.array(z.string()).min(1), wordCount: z.number().int().positive().optional() })).default([]),
  activities: z.array(ReferenceActivitySchema).min(1),
  figures: z.array(ReferenceFigureSchema).default([]),
  answers: z.array(AnswerSchema),
  /** Numbers an admissible support may print although the sheet does not (a general fact such as 1 km = 1000 m). */
  admissibleNumbers: z.array(z.string()).default([]),
  barriers: z.array(z.object({ id: z.string().regex(/^bar_[a-z0-9_]{1,30}$/), description: z.string() })).min(1),
  admissibleAdaptations: z.array(z.string()).min(1),
  unacceptableChanges: z.array(z.string()).min(1),
  referenceAdaptation: z.lazy(() => AdaptedSheetSchema).nullable(),
  validation: TeacherValidationSchema,
});
export type ReferenceSheet = z.infer<typeof ReferenceSheetSchema>;

export const SUPPORT_KINDS = ["glosario", "segmentacion", "resaltado", "organizador_vacio", "recordatorio_general", "ejemplo_distinto", "espacio_respuesta", "lectura_en_voz_alta", "formato_visual", "pista"] as const;

export const AdaptedActivitySchema = z.object({
  /** Original activity ids this adapted activity covers (more than one = consignas mezcladas). */
  sourceIds: z.array(z.string()).min(1),
  number: z.string().max(5),
  instruction: z.string().min(1),
  /** Student-facing content of the activity (problem statement, items to order, table rows…). */
  content: z.string().default(""),
  operations: z.array(z.enum(OPERATIONS)).min(1),
  supports: z.array(z.object({ kind: z.enum(SUPPORT_KINDS), text: z.string(), addresses: z.array(z.string()).default([]) })).default([]),
});

export const AdaptedSheetSchema = z.object({
  referenceId: z.string(),
  /** How it was produced: a controlled script (correct or mutated), never a paid model in this phase. */
  producedBy: z.string(),
  sourceTexts: z.array(z.object({ id: z.string(), text: z.string() })).default([]),
  activities: z.array(AdaptedActivitySchema),
  figures: z.array(z.object({ id: z.string(), activityIds: z.array(z.string()), kind: z.string(), facts: FigureFactsSchema })).default([]),
});
export type AdaptedSheet = z.infer<typeof AdaptedSheetSchema>;
export type AdaptedActivity = z.infer<typeof AdaptedActivitySchema>;

export const CRITERIA = ["A_conservacion_datos", "B_integridad_actividad", "C_seguridad_respuestas", "D_accesibilidad", "E_fidelidad_pedagogica"] as const;
export type Criterion = (typeof CRITERIA)[number];
export const STATUSES = ["PASS", "FAIL", "NEEDS_TEACHER_REVIEW", "NOT_APPLICABLE"] as const;
export type Status = (typeof STATUSES)[number];

export interface Finding {
  criterion: Criterion;
  check: string;
  status: Status;
  activityId: string | null;
  detail: string;
}

export interface Evaluation {
  referenceId: string;
  /** FAIL if any check fails; otherwise NEEDS_TEACHER_REVIEW: a pedagogical judgement is never turned into PASS automatically. */
  verdict: "FAIL" | "NEEDS_TEACHER_REVIEW";
  byCriterion: Record<Criterion, Status>;
  findings: Finding[];
}

/**
 * Transcription of the ORIGINAL sheet as printed (material, not evaluation data): what a controlled adapter may read. It carries
 * no answers, no "elements to keep" and no unacceptable changes; those live only in the ReferenceSheet used to score.
 */
export const OriginalSheetSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,60}$/),
  sourceTexts: z.array(z.object({ id: z.string(), text: z.string().min(1) })).default([]),
  activities: z.array(z.object({ id: z.string().regex(/^act_[0-9]{1,3}$/), number: z.string().max(5), instruction: z.string().min(3), content: z.string().default(""), operations: z.array(z.enum(OPERATIONS)).min(1) })).min(1),
  figures: z.array(z.object({ id: z.string(), activityIds: z.array(z.string()), kind: z.string(), facts: FigureFactsSchema })).default([]),
});
export type OriginalSheet = z.infer<typeof OriginalSheetSchema>;
