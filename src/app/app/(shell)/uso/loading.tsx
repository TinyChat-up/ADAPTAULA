import { PageSkeleton } from "@/components/app/page-skeleton";

export default function Loading() {
  return <PageSkeleton label="Cargando tu plan" cards={2} rows={2} />;
}
