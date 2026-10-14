import { PageSkeleton } from "@/components/app/page-skeleton";

export default function Loading() {
  return <PageSkeleton label="Cargando el inicio" hero rows={5} />;
}
