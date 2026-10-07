import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { AdaptationList } from "@/components/adaptation/adaptation-list";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { listAdaptations } from "@/lib/adaptation/orchestration/page-data";
import { requireWorkspace } from "@/lib/auth/workspace";

export const metadata: Metadata = { title: "Historial" };
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  await requireWorkspace();
  const items = await listAdaptations({ limit: 100 });
  return (
    <div className="space-y-8">
      <PageHeader title="Historial" description="Tus adaptaciones, de la más reciente a la más antigua." />
      {items.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Aún no hay adaptaciones" description="Sube un material, elige un perfil y aquí verás cada adaptación y en qué punto está.">
          <LinkButton href="/app/adaptar">Adaptar material</LinkButton>
        </EmptyState>
      ) : (
        <AdaptationList items={items} />
      )}
    </div>
  );
}
