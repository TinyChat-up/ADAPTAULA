import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type PDFImage,
} from "pdf-lib";
import {
  fetchPictogramAsset,
  loadAdaptationForExport,
  parseStructuredContentForExport,
  splitParagraphs,
  toSafeSlug,
} from "@/lib/export/adaptationExport";

const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 56,
};

function drawWrappedText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
  maxWidth: number,
  lineGap = 4,
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  const lineHeight = size + lineGap;
  let cursorY = y;
  for (const line of lines) {
    page.drawText(line, {
      x,
      y: cursorY,
      size,
      font,
      color: rgb(0.1, 0.11, 0.11),
    });
    cursorY -= lineHeight;
  }
  return cursorY;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const loaded = await loadAdaptationForExport(req);
    if ("error" in loaded) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    const { adaptation } = loaded;

    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const maxWidth = PAGE.width - PAGE.margin * 2;

    let page = pdf.addPage([PAGE.width, PAGE.height]);
    let cursorY = PAGE.height - PAGE.margin;
    const imageCache = new Map<string, PDFImage>();

    const ensureSpace = (needed = 24) => {
      if (cursorY - needed < PAGE.margin) {
        page = pdf.addPage([PAGE.width, PAGE.height]);
        cursorY = PAGE.height - PAGE.margin;
      }
    };

    const drawBlock = (
      text: string,
      fontKind: "bold" | "regular",
      size: number,
      gapAfter = 14,
    ) => {
      ensureSpace(size + 20);
      cursorY = drawWrappedText(
        page,
        text,
        fontKind === "bold" ? bold : regular,
        size,
        PAGE.margin,
        cursorY,
        maxWidth,
      );
      cursorY -= gapAfter;
    };

    const createdDate = adaptation.createdAt
      ? new Intl.DateTimeFormat("es-ES", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(adaptation.createdAt))
      : "No disponible";

    drawBlock(adaptation.title, "bold", 24, 8);
    drawBlock(`Versión v${adaptation.versionNumber}`, "regular", 11, 6);
    drawBlock(`Fecha: ${createdDate}`, "regular", 11, 4);
    drawBlock(`Tipo de adaptación: ${adaptation.adaptationType}`, "regular", 11, 4);
    drawBlock(`Formato de salida: ${adaptation.outputFormat}`, "regular", 11, 4);
    drawBlock(`Perfil: ${adaptation.studentProfile}`, "regular", 11, 4);
    if (adaptation.styleName) {
      drawBlock(`Estilo aplicado: ${adaptation.styleName}`, "regular", 11, 4);
    }

    cursorY -= 8;
    drawBlock("Contenido adaptado", "bold", 14, 10);

    const blocks = parseStructuredContentForExport({
      contentHtml: adaptation.contentHtml,
      contentPlain: adaptation.contentPlain,
      pictogramData: adaptation.pictogramData,
    });

    for (const block of blocks) {
      if (block.kind === "response_lines") {
        const lines = Math.max(1, block.responseLines || 2);
        for (let idx = 0; idx < lines; idx += 1) {
          ensureSpace(28);
          page.drawLine({
            start: { x: PAGE.margin, y: cursorY },
            end: { x: PAGE.width - PAGE.margin, y: cursorY },
            thickness: 0.9,
            color: rgb(0.74, 0.79, 0.85),
          });
          cursorY -= 24;
        }
        cursorY -= 6;
        continue;
      }

      if (block.kind === "response_box") {
        ensureSpace(118);
        page.drawRectangle({
          x: PAGE.margin,
          y: cursorY - 100,
          width: maxWidth,
          height: 96,
          borderColor: rgb(0.72, 0.78, 0.84),
          borderWidth: 1,
        });
        cursorY -= 114;
        continue;
      }

      ensureSpace(60);
      let text = block.text;
      let font = regular;
      let size = 11.5;
      let gapAfter = 10;

      if (block.kind === "h1") {
        font = bold;
        size = 16;
        gapAfter = 10;
      } else if (block.kind === "h2") {
        font = bold;
        size = 14;
        gapAfter = 9;
      } else if (block.kind === "h3") {
        font = bold;
        size = 12.5;
        gapAfter = 8;
      } else if (block.kind === "section_title") {
        font = bold;
        size = 13;
        gapAfter = 10;
        page.drawRectangle({
          x: PAGE.margin - 4,
          y: cursorY - 20,
          width: maxWidth + 8,
          height: 24,
          color: rgb(0.93, 0.985, 0.96),
          borderColor: rgb(0.78, 0.92, 0.86),
          borderWidth: 0.8,
        });
      } else if (block.kind === "question") {
        font = bold;
        size = 11.5;
        gapAfter = 8;
        page.drawRectangle({
          x: PAGE.margin - 2,
          y: cursorY - 18,
          width: maxWidth + 4,
          height: 22,
          color: rgb(0.973, 0.98, 0.99),
          borderColor: rgb(0.87, 0.9, 0.95),
          borderWidth: 0.6,
        });
      } else if (block.kind === "li") {
        text = `• ${text}`;
      } else if (block.kind === "instructions") {
        page.drawRectangle({
          x: PAGE.margin - 2,
          y: cursorY - 24,
          width: maxWidth + 4,
          height: 30,
          color: rgb(0.925, 0.992, 0.96),
          borderColor: rgb(0.73, 0.94, 0.84),
          borderWidth: 0.7,
        });
      }

      cursorY = drawWrappedText(page, text, font, size, PAGE.margin, cursorY, maxWidth);
      cursorY -= gapAfter;

      const pictograms = block.pictograms.slice(0, 2);
      if (pictograms.length > 0) {
        ensureSpace(38);
        let imageX = PAGE.margin;
        const imageSize = 20;
        for (const pictogram of pictograms) {
          if (imageX + 130 > PAGE.width - PAGE.margin) break;
          try {
            const cacheKey = `${pictogram.id}-${pictogram.imageUrl}`;
            let image = imageCache.get(cacheKey);
            if (!image) {
              const asset = await fetchPictogramAsset(pictogram.imageUrl);
              image =
                asset.mimeType === "jpg"
                  ? await pdf.embedJpg(asset.bytes)
                  : await pdf.embedPng(asset.bytes);
              imageCache.set(cacheKey, image);
            }

            page.drawRectangle({
              x: imageX - 4,
              y: cursorY - 4,
              width: 112,
              height: 28,
              color: rgb(0.953, 0.953, 0.953),
              borderColor: rgb(0.887, 0.887, 0.887),
              borderWidth: 0.6,
            });
            page.drawImage(image, {
              x: imageX,
              y: cursorY,
              width: imageSize,
              height: imageSize,
            });
            page.drawText(pictogram.concept, {
              x: imageX + imageSize + 6,
              y: cursorY + 6,
              size: 10,
              font: bold,
              color: rgb(0.24, 0.29, 0.26),
            });
            imageX += 120;
          } catch {
            page.drawText(`[${pictogram.concept}]`, {
              x: imageX,
              y: cursorY + 6,
              size: 10,
              font: regular,
              color: rgb(0.24, 0.29, 0.26),
            });
            imageX += 90;
          }
        }
        cursorY -= 34;
      }
      cursorY -= 2;
    }

    if (adaptation.aiNotes) {
      cursorY -= 6;
      drawBlock("Notas de IA", "bold", 13, 8);
      const notes = splitParagraphs(adaptation.aiNotes);
      for (const note of notes) {
        ensureSpace(50);
        cursorY = drawWrappedText(
          page,
          note,
          regular,
          11,
          PAGE.margin,
          cursorY,
          maxWidth,
        );
        cursorY -= 10;
      }
    }

    const bytes = await pdf.save();
    const arrayBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(arrayBuffer).set(bytes);
    const body = new Blob([arrayBuffer], { type: "application/pdf" });
    const slug = toSafeSlug(adaptation.title) || "adaptacion";
    const fileName = `${slug}-v${adaptation.versionNumber}.pdf`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"${fileName}\"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error desconocido al exportar PDF.",
      },
      { status: 500 },
    );
  }
}
