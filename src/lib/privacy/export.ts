import "server-only";
import { createHash } from "node:crypto";
import { getSupabase } from "@/lib/auth/session";

const MAX_ROWS = 500;
// Keep the resulting JSON small enough for a normal serverless response, after base64 expansion.
const MAX_EMBEDDED_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 30;

export class ExportTooLargeError extends Error {}

/** Only explicit columns are copied: no auth tokens, internal jobs, logs or provider credentials. */
export async function buildAccountExport(user: { id: string; email?: string }, profile: {
  fullName: string | null; teachingStages: string[]; onboardingCompleted: boolean;
}) {
  const db = await getSupabase();
  const { data: memberships, error: membershipError } = await db.from("workspace_members")
    .select("workspace_id, role, workspaces(id, name, type)").eq("user_id", user.id).limit(MAX_ROWS + 1);
  if (membershipError) throw membershipError;
  if ((memberships?.length ?? 0) > MAX_ROWS) throw new ExportTooLargeError();

  const spaces: unknown[] = [];
  for (const membership of memberships ?? []) {
    const ws = membership.workspaces as unknown as { id: string; name: string; type: string } | null;
    if (!ws) continue;
    // Shared workspace documents belong to the group. This personal export does not
    // disclose material, profiles or revisions created by another member.
    const { count, error: membersError } = await db.from("workspace_members")
      .select("user_id", { count: "exact", head: true }).eq("workspace_id", ws.id);
    if (membersError) throw membersError;
    const personal = ws.type === "personal" && membership.role === "owner" && count === 1;
    if (!personal) {
      spaces.push({ id: ws.id, name: ws.name, type: ws.type, role: membership.role, included: false,
        reason: "El contenido de espacios compartidos no se incluye en la copia personal." });
      continue;
    }
    const workspaceId = ws.id;

    async function rows(table: string, columns: string) {
      const { data, error } = await db.from(table).select(columns).eq("workspace_id", workspaceId).limit(MAX_ROWS + 1);
      if (error) throw error;
      if ((data?.length ?? 0) > MAX_ROWS) throw new ExportTooLargeError();
      const allowed = columns.split(",");
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((record) =>
        Object.fromEntries(allowed.map((column) => [column, record[column]])));
    }
    const [learnerProfiles, classes, classLearners, materials, materialFiles, adaptations, versions, drafts, feedback] = await Promise.all([
      rows("learner_profiles", "id,display_name,stage_slug,grade_slug,functional_profile,archived_at,created_at,updated_at"),
      rows("classes", "id,name,stage_slug,grade_slug,academic_year,archived_at,created_at,updated_at"),
      rows("class_learners", "class_id,learner_profile_id"),
      rows("materials", "id,title,stage_slug,grade_slug,subject_slug,topic,source_type,status,content_hash,analysis,page_count,created_at,updated_at"),
      rows("material_files", "id,material_id,bucket,storage_path,mime_type,size_bytes,page_count,kind,created_at"),
      rows("adaptations", "id,material_id,learner_profile_id,title,adaptation_type,profile_snapshot,strategy,plan,change_summary,visual_template,status,current_version,created_at,updated_at"),
      rows("adaptation_versions", "id,adaptation_id,version,document,review,source,created_at"),
      rows("adaptation_drafts", "id,adaptation_id,base_version,revision,changes,content_acknowledged,created_at"),
      rows("adaptation_feedback", "id,adaptation_id,helpful,reasons,comment,created_at"),
    ]);
    const files = [];
    let bytesUsed = 0;
    for (const file of materialFiles as Array<{ kind: string; material_id: string; mime_type: string; size_bytes: number; storage_path: string }>) {
      if (file.kind !== "source") continue;
      const canEmbed = files.length < MAX_FILES && bytesUsed + Number(file.size_bytes) <= MAX_EMBEDDED_BYTES;
      if (!canEmbed) {
        files.push({ material_id: file.material_id, mime_type: file.mime_type, size_bytes: file.size_bytes,
          embedded: false, download_path: `/api/materials/${file.material_id}/file?download=1` });
        continue;
      }
      // User-scoped Storage client uses the existing private bucket policy.
      const { data: blob, error } = await db.storage.from("source-materials").download(file.storage_path);
      if (error || !blob) throw new Error("No se pudo recuperar un archivo original.");
      const buffer = Buffer.from(await blob.arrayBuffer());
      if (buffer.length !== Number(file.size_bytes)) throw new Error("El tamaño del archivo original ha cambiado.");
      bytesUsed += buffer.length;
      files.push({ material_id: file.material_id, mime_type: file.mime_type, size_bytes: buffer.length,
        embedded: true, sha256: createHash("sha256").update(buffer).digest("hex"), data_base64: buffer.toString("base64") });
    }
    spaces.push({ id: ws.id, name: ws.name, type: ws.type, role: membership.role, included: true,
      learner_profiles: learnerProfiles, classes, class_learners: classLearners, materials, adaptations,
      adaptation_versions: versions, adaptation_drafts: drafts, adaptation_feedback: feedback, original_files: files });
  }
  return { format: "adaptaula-account-export", version: 1, exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email ?? null, full_name: profile.fullName,
      teaching_stages: profile.teachingStages, onboarding_completed: profile.onboardingCompleted }, workspaces: spaces };
}
