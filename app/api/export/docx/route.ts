import { NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ImageRun,
} from "docx";
import {
  fetchPictogramAsset,
  loadAdaptationForExport,
  parseStructuredContentForExport,
  toSafeSlug,
} from "@/lib/export/adaptationExport";
import { getUserPlan } from "@/lib/subscriptionService";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    // ── Auth (existing) + plan check ────────────────────────────────────────
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
    }

    const plan = await getUserPlan(user.id);
    if (plan !== "pro") {
      return NextResponse.json(
        {
          error: "Necesitas suscripción Pro para exportar en DOCX",
          code: "SUBSCRIPTION_REQUIRED",
        },
        { status: 403 },
      );
    }

    const loaded = await loadAdaptationForExport(req);
    if ("error" in loaded) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    const { adaptation } = loaded;

    const createdDate = adaptation.createdAt
      ? new Intl.DateTimeFormat("es-ES", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(adaptation.createdAt))
      : "";

    const blocks = parseStructuredContentForExport({
      contentHtml: adaptation.contentHtml,
      contentPlain: adaptation.contentPlain,
      pictogramData: adaptation.pictogramData,
    });
    const pictogramCache = new Map<string, Awaited<ReturnType<typeof fetchPictogramAsset>>>();
    const bodyParagraphs: Paragraph[] = [];

    for (const block of blocks) {
      if (block.kind === "response_lines") {
        const lines = Math.max(1, block.responseLines || 2);
        for (let idx = 0; idx < lines; idx += 1) {
          bodyParagraphs.push(
            new Paragraph({
              children: [new TextRun("___________________________________________")],
              spacing: { after: idx === lines - 1 ? 180 : 120 },
            }),
          );
        }
        continue;
      }

      if (block.kind === "response_box") {
        bodyParagraphs.push(
          new Paragraph({
            children: [new TextRun(" ")],
            spacing: { after: 80 },
          }),
        );
        for (let idx = 0; idx < 4; idx += 1) {
          bodyParagraphs.push(
            new Paragraph({
              children: [new TextRun("___________________________________________")],
              spacing: { after: idx === 3 ? 180 : 120 },
            }),
          );
        }
        continue;
      }

      const runs: Array<TextRun | ImageRun> = [new TextRun(block.text)];

      const limitedPictograms = block.pictograms.slice(0, 2);
      for (const pictogram of limitedPictograms) {
        try {
          const cacheKey = `${pictogram.id}-${pictogram.imageUrl}`;
          let asset = pictogramCache.get(cacheKey);
          if (!asset) {
            asset = await fetchPictogramAsset(pictogram.imageUrl);
            pictogramCache.set(cacheKey, asset);
          }
          runs.push(new TextRun(" "));
          runs.push(
            new ImageRun({
              data: asset.bytes,
              transformation: { width: 24, height: 24 },
              type: asset.mimeType,
              altText: {
                name: pictogram.concept,
                title: pictogram.concept,
                description: pictogram.keyword || pictogram.concept,
              },
            }),
          );
          runs.push(new TextRun(` ${pictogram.concept}`));
        } catch {
          runs.push(new TextRun(` [${pictogram.concept}]`));
        }
      }

      const baseConfig = {
        children: runs,
        spacing: { after: block.kind === "li" ? 120 : 180 },
      };

      if (block.kind === "h1") {
        bodyParagraphs.push(
          new Paragraph({
            ...baseConfig,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 180, after: 180 },
          }),
        );
      } else if (block.kind === "h2") {
        bodyParagraphs.push(
          new Paragraph({
            ...baseConfig,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 160, after: 140 },
          }),
        );
      } else if (block.kind === "h3") {
        bodyParagraphs.push(
          new Paragraph({
            ...baseConfig,
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 120, after: 120 },
          }),
        );
      } else if (block.kind === "section_title") {
        bodyParagraphs.push(
          new Paragraph({
            ...baseConfig,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 220, after: 160 },
          }),
        );
      } else if (block.kind === "question") {
        bodyParagraphs.push(
          new Paragraph({
            ...baseConfig,
            spacing: { before: 100, after: 140 },
          }),
        );
      } else if (block.kind === "li") {
        bodyParagraphs.push(
          new Paragraph({
            ...baseConfig,
            bullet: { level: 0 },
          }),
        );
      } else if (block.kind === "instructions") {
        bodyParagraphs.push(
          new Paragraph({
            ...baseConfig,
            spacing: { before: 80, after: 200 },
          }),
        );
      } else {
        bodyParagraphs.push(new Paragraph(baseConfig));
      }
    }

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: adaptation.title,
              heading: HeadingLevel.HEADING_1,
              spacing: { after: 240 },
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `Versión: v${adaptation.versionNumber}`, bold: true }),
              ],
            }),
            ...(createdDate
              ? [
                  new Paragraph({
                    children: [
                      new TextRun({ text: `Fecha: ${createdDate}`, bold: true }),
                    ],
                  }),
                ]
              : []),
            new Paragraph({
              children: [
                new TextRun({ text: `Tipo de adaptación: ${adaptation.adaptationType}`, bold: true }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `Formato de salida: ${adaptation.outputFormat}`, bold: true }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `Perfil: ${adaptation.studentProfile}`, bold: true }),
              ],
              spacing: { after: 180 },
            }),
            ...(adaptation.styleName
              ? [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `Estilo aplicado: ${adaptation.styleName}`,
                        bold: true,
                      }),
                    ],
                  }),
                ]
              : []),
            new Paragraph({
              children: [new TextRun("")],
              spacing: { after: 340 },
            }),
            ...bodyParagraphs,
            ...(adaptation.aiNotes
              ? [
                  new Paragraph({
                    text: "Notas de IA",
                    heading: HeadingLevel.HEADING_2,
                    spacing: { before: 400, after: 180 },
                  }),
                  new Paragraph({
                    children: [new TextRun(adaptation.aiNotes)],
                    spacing: { after: 220 },
                  }),
                ]
              : []),
          ],
        },
      ],
    });

    const body = await Packer.toBlob(doc);
    const slug = toSafeSlug(adaptation.title) || "adaptacion";
    const fileName = `${slug}-v${adaptation.versionNumber}.docx`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
            : "Error desconocido al exportar DOCX.",
      },
      { status: 500 },
    );
  }
}
