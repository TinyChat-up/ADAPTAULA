import { PageSkeleton } from "@/components/app/page-skeleton";

export default function Loading() {
  return <PageSkeleton label="Cargando el inicio" hero cards={3} rows={3} />;
}
