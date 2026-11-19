import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { RecreationScreen, RegenerateNotice } from "@/components/recreation/recreation-screen";
import type { RecreationReader } from "@/lib/recreation/record";
import { loadRecreationView } from "@/lib/recreation/view";
import type { WorkspaceUsage } from "@/lib/schemas/plan";

export const metadata: Metadata = { title: "Material recreado (demostración)" };
export const dynamic = "force-dynamic";

/**
 * Demonstration of the recreation screen (ADR-051) with the stored pond recreation: simulated Claude and OpenAI, generated once
 * (`./data`, only what a member can read: no answers, no internal part). Development only and only with `ADAPTAULA_DEMO=1`: in a
 * production build the branch below is removed, so the data is not even bundled. It has no session, no workspace and no data of
 * anyone, reads no file at run time and cannot call a model (`loadRecreationView`).
 */
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
  // `NODE_ENV` is a build-time constant: in a production build this expression is `null` and the import, data included, is removed.
  const demo = process.env.NODE_ENV !== "production" && process.env.ADAPTAULA_DEMO === "1" ? (await import("./data")).demo : null;
  if (!demo) notFound();
  const { line, version, images } = demo;
  // Only the readable part exists here: the demo has no internal data (no answers) to read even by mistake.
  const reader: RecreationReader = {
    getLine: async (id) => (id === line.id ? line : null),
    getVersion: async (id, n) => (id === line.id && n === version.version ? version : null),
    listVersions: async () => [{ version: version.version, created_at: version.created_at, state: version.state }],
  };
  const requested = Number((await searchParams).version);
  const view = await loadRecreationView(reader, line.id, Number.isInteger(requested) && requested > 0 ? requested : undefined);
  if (!view) notFound();
  const imageSrc = Object.fromEntries(view.assets.map((a) => [a.asset_id, images[a.asset_id] ?? ""]));
  return (
    <AppShell usage={DEMO_USAGE} user={{ name: "Docente de demostración", email: undefined }}>
      <RecreationScreen view={view} imageSrc={imageSrc} subjectLabel="Ciencias de la Naturaleza · 5.º Primaria" versionHref={(n) => `/demo/recreacion?version=${n}`} regenerate={<RegenerateNotice disabledReason="En la demostración no se generan materiales nuevos." />} />
    </AppShell>
  );
}
