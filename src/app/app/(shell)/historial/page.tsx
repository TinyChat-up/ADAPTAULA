import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { ComingSoon } from "@/components/app/coming-soon";

export const metadata: Metadata = { title: "Historial" };

export default function HistoryPage() {
  return (
    <ComingSoon
      title="Historial"
      description="Todas tus adaptaciones, ordenadas por fecha."
      icon={CalendarClock}
      emptyTitle="Aún no hay adaptaciones"
      emptyText="Tus adaptaciones aparecerán aquí en cuanto crees la primera."
    />
  );
}
