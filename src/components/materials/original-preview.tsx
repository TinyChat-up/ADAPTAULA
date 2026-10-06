import { FileText } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/layout";

function formatSize(bytes: number): string {
  const mib = 1024 * 1024;
  return bytes >= mib ? `${(bytes / mib).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The original, served through an authorized route that issues short-lived links: no permanent URL exists. */
export function OriginalPreview({
  materialId,
  file,
}: {
  materialId: string;
  file: { mime_type: string; size_bytes: number; page_count: number | null; original_name: string | null };
}) {
  const src = `/api/materials/${materialId}/file`;
  const isImage = file.mime_type.startsWith("image/");
  const isPdf = file.mime_type === "application/pdf";
  const inlinePdf = isPdf && file.size_bytes <= 4 * 1024 * 1024;

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold">Original</h2>
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- authorized, short-lived redirect: next/image cannot proxy it
        <img src={src} alt={`Vista previa de ${file.original_name ?? "tu material"}`} className="max-h-96 w-full rounded-control border border-border object-contain" />
      ) : inlinePdf ? (
        <iframe src={src} title="Vista previa del PDF original" className="h-96 w-full rounded-control border border-border" />
      ) : (
        <div className="flex items-center gap-3 rounded-control bg-background p-4">
          <FileText aria-hidden className="size-8 text-primary" />
          <p className="text-sm text-muted-foreground">La vista previa no está disponible para este PDF. Puedes abrirlo o descargarlo.</p>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {file.original_name ? `${file.original_name} · ` : ""}
        {formatSize(file.size_bytes)}
        {file.page_count ? ` · ${file.page_count} ${file.page_count === 1 ? "página" : "páginas"}` : ""}
      </p>
      <LinkButton href={`${src}?download=1`} variant="secondary" size="sm" prefetch={false}>
        Descargar original
      </LinkButton>
    </Card>
  );
}
