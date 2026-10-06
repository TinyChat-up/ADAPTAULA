import "server-only";
import { z } from "zod";
import { getSupabase } from "@/lib/auth/session";
import { AnalysisMetaSchema } from "@/lib/schemas/material-analysis";
import {
  MATERIAL_COLUMNS,
  MaterialRowSchema,
  parseAnalysis,
  type MaterialDetail,
  type MaterialFileRow,
  type MaterialJobRow,
  type MaterialRow,
  type MaterialStatus,
} from "./types";

const FileRowSchema = z.object({
  id: z.uuid(),
  storage_path: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
  page_count: z.number().nullable(),
  original_name: z.string().nullable(),
});

const JobRowSchema = z.object({ status: z.string(), step: z.string().nullable(), progress: z.number(), attempts: z.number() });

export interface MaterialFilters {
  stage?: string | undefined;
  subject?: string | undefined;
  status?: MaterialStatus | undefined;
}

export async function listMaterials(workspaceId: string, filters: MaterialFilters = {}): Promise<MaterialRow[]> {
  const supabase = await getSupabase();
  let query = supabase.from("materials").select(MATERIAL_COLUMNS).eq("workspace_id", workspaceId);
  // Half-uploaded rows are plumbing, not materials: they are not listed.
  query = filters.status ? query.eq("status", filters.status) : query.neq("status", "uploading");
  if (filters.stage) query = query.eq("stage_slug", filters.stage);
  if (filters.subject) query = query.eq("subject_slug", filters.subject);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error("No se han podido cargar los materiales.");
  return z.array(MaterialRowSchema).parse(data);
}

export async function countMaterials(workspaceId: string): Promise<number> {
  const supabase = await getSupabase();
  const { count, error } = await supabase
    .from("materials")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .neq("status", "uploading");
  if (error) throw new Error("No se han podido contar los materiales.");
  return count ?? 0;
}

/** Missing, malformed id and another workspace's material are indistinguishable: all return null. */
export async function getMaterialDetail(workspaceId: string, id: string): Promise<MaterialDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("materials")
    .select(`${MATERIAL_COLUMNS}, analysis, analysis_meta`)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("No se ha podido cargar el material.");
  if (!data) return null;

  const { analysis: rawAnalysis, analysis_meta: rawMeta, ...rest } = data as Record<string, unknown>;
  const material = MaterialRowSchema.parse(rest);
  const { analysis, outdated } = parseAnalysis(rawAnalysis);

  const [files, jobs] = await Promise.all([
    supabase.from("material_files").select("id, storage_path, mime_type, size_bytes, page_count, original_name").eq("material_id", id).eq("kind", "source").limit(1),
    supabase.from("adaptation_jobs").select("status, step, progress, attempts").eq("material_id", id).eq("kind", "analyze").order("created_at", { ascending: false }).limit(1),
  ]);
  if (files.error || jobs.error) throw new Error("No se ha podido cargar el material.");

  const file: MaterialFileRow | null = files.data?.[0] ? FileRowSchema.parse(files.data[0]) : null;
  const job: MaterialJobRow | null = jobs.data?.[0] ? JobRowSchema.parse(jobs.data[0]) : null;
  const meta = AnalysisMetaSchema.safeParse(rawMeta);
  return { material, file, analysis, meta: meta.success ? meta.data : null, analysisOutdated: outdated, job };
}

export interface ContextUpdate {
  title?: string | undefined;
  stage_slug?: string | null | undefined;
  grade_slug?: string | null | undefined;
  subject_slug?: string | null | undefined;
  topic?: string | null | undefined;
  confirmed_fields: string[];
}

/** The teacher's corrections. Goes through RLS: only members who can write may change a material. */
export async function updateMaterialContext(workspaceId: string, id: string, update: ContextUpdate): Promise<boolean> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("materials").update(update).eq("workspace_id", workspaceId).eq("id", id).select("id");
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

export async function getSubjects(): Promise<Array<{ slug: string; name: string; stage_slugs: string[] }>> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("subjects").select("slug, name, stage_slugs").eq("active", true).order("sort_order");
  if (error) throw new Error("No se ha podido cargar el catálogo de asignaturas.");
  return z.array(z.object({ slug: z.string(), name: z.string(), stage_slugs: z.array(z.string()) })).parse(data);
}
