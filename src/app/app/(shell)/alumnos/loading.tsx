import { PageSkeleton } from "@/components/app/page-skeleton";

export default function Loading() {
  return <PageSkeleton label="Cargando perfiles" rows={3} />;
}
