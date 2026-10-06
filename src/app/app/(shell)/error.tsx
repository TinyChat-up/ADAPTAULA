"use client";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

export default function ShellError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-12">
      <Alert tone="danger" title="Algo no ha ido bien">
        No hemos podido cargar esta pantalla. Tus datos están a salvo. Inténtalo de nuevo.
      </Alert>
      <Button onClick={reset}>Reintentar</Button>
    </div>
  );
}
