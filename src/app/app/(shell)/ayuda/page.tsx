import type { Metadata } from "next";
import { CircleHelp } from "lucide-react";
import { ComingSoon } from "@/components/app/coming-soon";

export const metadata: Metadata = { title: "Ayuda" };

export default function HelpPage() {
  return (
    <ComingSoon
      title="Ayuda"
      description="Guías y contacto."
      icon={CircleHelp}
      emptyTitle="El centro de ayuda llegará pronto"
      emptyText="Mientras tanto, puedes repasar cómo funciona Adaptaula."
      action={{ href: "/como-funciona", label: "Ver cómo funciona" }}
    />
  );
}
