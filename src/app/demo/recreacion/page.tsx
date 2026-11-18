import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { RecreationScreen, RegenerateNotice } from "@/components/recreation/recreation-screen";
import { MemoryRecreationStore, RecreationRecordSchema } from "@/lib/recreation/record";
import { loadRecreationView } from "@/lib/recreation/view";
import type { WorkspaceUsage } from "@/lib/schemas/plan";

export const metadata: Metadata = { title: "Material recreado (demostración)" };
export const dynamic = "force-dynamic";

/**
 * Demonstration of the recreation screen (ADR-051) with the stored pond recreation: simulated Claude and OpenAI, generated once and
 * kept in `src/lib/recreation/demo/`. Off unless `ADAPTAULA_DEMO=1` (never in production): it has no session, no workspace and no
 * data of anyone. It reads the record and shows it; it cannot call a model (`loadRecreationView`).
 */
const DIR = path.join(process.cwd(), "src/lib/recreation/demo");
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

export default async function RecreationDemoPage() {
  if (process.env.ADAPTAULA_DEMO !== "1" || process.env.VERCEL_ENV === "production") notFound();
  const record = RecreationRecordSchema.parse(JSON.parse(readFileSync(path.join(DIR, "pond-record.json"), "utf8")));
  const store = new MemoryRecreationStore();
  await store.save(record);
  const view = (await loadRecreationView(store, record.id))!;
  const png = readFileSync(path.join(DIR, "pond-illustration.png")).toString("base64");
  const imageSrc = Object.fromEntries(view.assets.map((a) => [a.asset_id, `data:image/png;base64,${png}`]));
  return (
    <AppShell usage={DEMO_USAGE} user={{ name: "Docente de demostración", email: undefined }}>
      <RecreationScreen view={view} imageSrc={imageSrc} subjectLabel="Ciencias de la Naturaleza · 5.º Primaria" regenerate={<RegenerateNotice disabledReason="En la demostración no se generan materiales nuevos." />} />
    </AppShell>
  );
}
