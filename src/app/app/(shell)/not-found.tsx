import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";

export default function ShellNotFound() {
  return (
    <div className="py-8">
      <EmptyState title="No encontramos lo que buscas" description="Puede que ya no exista o que no tengas acceso.">
        <LinkButton href="/app">Volver al inicio</LinkButton>
      </EmptyState>
    </div>
  );
}
