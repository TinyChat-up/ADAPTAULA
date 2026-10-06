import type { Metadata } from "next";
import { MaterialUploader } from "@/components/materials/uploader";
import { PageHeader } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { effectiveLimits } from "@/lib/materials/config";
import { getWorkspaceUsage } from "@/lib/plans/usage";

export const metadata: Metadata = { title: "Adaptar material" };

export default async function AdaptPage() {
  const ctx = await requireWorkspace();
  const usage = await getWorkspaceUsage(ctx.workspace.id);
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Adapta un material" description="Sube una ficha que ya utilizas y prepararemos una versión adaptada." />
      <MaterialUploader limits={effectiveLimits(usage.features)} />
    </div>
  );
}
