import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { RecreationScreen, RegenerateNotice } from "@/components/recreation/recreation-screen";
import { RecreationLineSchema, RecreationVersionSchema, type RecreationReader } from "@/lib/recreation/record";
import { loadRecreationView } from "@/lib/recreation/view";
import type { WorkspaceUsage } from "@/lib/schemas/plan";

export const metadata: Metadata = { title: "Material recreado (demostración)" };
export const dynamic = "force-dynamic";

/**
 * Demonstration of the recreation screen (ADR-051) with the stored pond recreation: simulated Claude and OpenAI, generated once and
 * kept in `src/lib/recreation/demo/` — only what a member can read (no answers, no internal part). Off unless `ADAPTAULA_DEMO=1` (never in production): it has no session, no workspace and no
 * data of anyone. It reads the record and shows it; it cannot call a model (`loadRecreationView`).
 */
// ADAPTAULA_DEMO_DIR: the folder of an evaluation run (evals/results/recreation/<stamp>) to review its result without any API call.
const DIR = path.join(process.cwd(), process.env.ADAPTAULA_DEMO_DIR ?? "src/lib/recreation/demo");
const DEMO_USAGE: WorkspaceUsage = {
  plan: { slug: "max", name: "Max" },
  period_start: "2026-11-01",
  period_end: "2026-11-30",
  adaptations: { used: 3, limit: 40 },
  images: { used: 1, limit: 30 },
  block_revisions: { used: 0, limit: 200 },
  analyses: { used: 4, limit: 60 },
  max_profiles: 30,
  max_classes: 6,
  features: {},
};

export default async function RecreationDemoPage({ searchParams }: { searchParams: Promise<{ version?: string }> }) {
  if (process.env.ADAPTAULA_DEMO !== "1" || process.env.VERCEL_ENV === "production") notFound();
  const line = RecreationLineSchema.parse(JSON.parse(readFileSync(path.join(DIR, existsSync(path.join(DIR, "line.json")) ? "line.json" : "pond-line.json"), "utf8")));
  const version = RecreationVersionSchema.parse(JSON.parse(readFileSync(path.join(DIR, existsSync(path.join(DIR, "version.json")) ? "version.json" : "pond-version.json"), "utf8")));
  // Only the readable part exists here: the demo has no internal data (no answers) to read even by mistake.
  const reader: RecreationReader = {
    getLine: async (id) => (id === line.id ? line : null),
    getVersion: async (id, n) => (id === line.id && n === version.version ? version : null),
    listVersions: async () => [{ version: version.version, created_at: version.created_at, state: version.state }],
  };
  const requested = Number((await searchParams).version);
  const view = await loadRecreationView(reader, line.id, Number.isInteger(requested) && requested > 0 ? requested : undefined);
  if (!view) notFound();
  const imageSrc = Object.fromEntries(view.assets.map((a) => [a.asset_id, `data:image/png;base64,${readFileSync(path.join(DIR, "assets", `${a.asset_id}.png`)).toString("base64")}`]));
  return (
    <AppShell usage={DEMO_USAGE} user={{ name: "Docente de demostración", email: undefined }}>
      <RecreationScreen view={view} imageSrc={imageSrc} subjectLabel="Ciencias de la Naturaleza · 5.º Primaria" versionHref={(n) => `/demo/recreacion?version=${n}`} regenerate={<RegenerateNotice disabledReason="En la demostración no se generan materiales nuevos." />} />
    </AppShell>
  );
}
