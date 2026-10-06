import type { Metadata } from "next";
import { LayoutTemplate } from "lucide-react";
import { ComingSoon } from "@/components/app/coming-soon";

export const metadata: Metadata = { title: "Plantillas" };

export default function TemplatesPage() {
  return (
    <ComingSoon
      title="Plantillas"
      description="Estilos visuales para tus materiales adaptados."
      icon={LayoutTemplate}
      emptyTitle="Las plantillas llegarán con las adaptaciones"
      emptyText="Podrás elegir el estilo visual de cada ficha cuando generes tu primera adaptación."
    />
  );
}
