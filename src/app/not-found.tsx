import { LinkButton } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="contenido" className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">No encontramos esta página</h1>
      <p className="text-muted-foreground">Puede que el enlace haya caducado o que no tengas acceso.</p>
      <LinkButton href="/">Volver al inicio</LinkButton>
    </main>
  );
}
