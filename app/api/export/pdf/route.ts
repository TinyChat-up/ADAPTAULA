import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserPlan } from "@/lib/subscriptionService";
import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";
import {
  buildAdaptationFromHtml,
  htmlToPlainText,
  toSafeSlug,
  type ExportAdaptationData,
} from "@/lib/export/adaptationExport";

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

    const plan = await getUserPlan(user.id);
    if (plan !== "pro") {
      return NextResponse.json(
        { error: "Necesitas suscripción Pro para exportar PDF", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 },
      );
    }

    const reqBody = await req.json() as {
      html?: string;
      adaptationId?: string;
      fontSize?: number;
      fontFamily?: string;
      lineHeight?: string;
    };

    // Sanitize style params against known-good values to prevent CSS injection
    const ALLOWED_FONTS = ["Arial, sans-serif", "Georgia, serif", "OpenDyslexic, sans-serif"];
    const ALLOWED_LINE_HEIGHTS = ["1.5", "1.8", "2.2"];
    const safeFontSize   = Math.min(22, Math.max(12, Number(reqBody.fontSize) || 16));
    const safeFontFamily = ALLOWED_FONTS.includes(reqBody.fontFamily ?? "") ? reqBody.fontFamily! : "Arial, sans-serif";
    const safeLineHeight = ALLOWED_LINE_HEIGHTS.includes(reqBody.lineHeight ?? "") ? reqBody.lineHeight! : "1.5";

    let adaptation: ExportAdaptationData;
    if (typeof reqBody.html === "string" && reqBody.html) {
      adaptation = buildAdaptationFromHtml(reqBody.html);
    } else if (reqBody.adaptationId) {
      const { data, error } = await supabase
        .from("adaptations")
        .select("id, result_html, adaptation_type, student_profile, ai_notes, created_at")
        .eq("id", reqBody.adaptationId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error || !data) {
        return NextResponse.json({ error: "Adaptación no encontrada." }, { status: 404 });
      }
      const row = data as Record<string, unknown>;
      const contentHtml = String(row.result_html || "");
      if (!contentHtml) {
        return NextResponse.json({ error: "Adaptación sin contenido exportable." }, { status: 400 });
      }
      adaptation = {
        id: String(row.id),
        title: "Adaptación AdaptAula",
        outputFormat: "Material adaptado",
        adaptationType: String(row.adaptation_type || "No definido"),
        studentProfile: String(row.student_profile || "No definido"),
        styleName: "",
        versionNumber: 1,
        createdAt: String(row.created_at || ""),
        contentHtml,
        contentPlain: htmlToPlainText(contentHtml),
        pictogramData: [],
        aiNotes: String(row.ai_notes || ""),
      };
    } else {
      return NextResponse.json({ error: "Falta html o adaptationId." }, { status: 400 });
    }

    // ── Build full HTML document for Puppeteer ────────────────────────────────
    // adaptation.contentHtml = <style id="aa-document-styles">…</style>\n<div class="aa-page">…</div>
    // Wrap it in a proper document and add print overrides.
    const fullHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    /* Teacher-selected typography */
    body, .aa-page { font-size: ${safeFontSize}px !important; font-family: ${safeFontFamily} !important; line-height: ${safeLineHeight} !important; }
    /* Print overrides: show all blocks, preserve backgrounds */
    .aa-block { opacity: 1 !important; transform: none !important; transition: none !important; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    /* Remove trailing whitespace at bottom of PDF */
    html, body { margin: 0 !important; padding: 0 !important; }
    body { padding-bottom: 0 !important; }
    .aa-page { padding-bottom: 0 !important; margin-bottom: 0 !important; }
    .aa-body > *:last-child { margin-bottom: 0 !important; padding-bottom: 0 !important; }
    .aa-block:last-child { margin-bottom: 0 !important; padding-bottom: 0 !important; }
    .aa-page > *:last-child { margin-bottom: 0 !important; padding-bottom: 0 !important; }
    @media print {
      body { margin: 0; padding: 0; }
      .aa-block { opacity: 1 !important; transform: none !important; }
    }
  </style>
</head>
<body>
${adaptation.contentHtml}
</body>
</html>`;

    // ── Render with Puppeteer ─────────────────────────────────────────────────
    const executablePath = await chromium.executablePath(
      "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar"
    );

    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 794, height: 1123 }); // A4 at 96dpi
      await page.setContent(fullHtml, { waitUntil: "networkidle0", timeout: 30000 });

      const pdfBytes = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      });

      const slug = toSafeSlug(adaptation.title) || "adaptacion";
      const fileName = `${slug}-v${adaptation.versionNumber}.pdf`;
      // Puppeteer returns Buffer; ensure it's a plain ArrayBuffer for NextResponse
      const arrayBuffer = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength,
      ) as ArrayBuffer;
      const pdfBlob = new Blob([arrayBuffer], { type: "application/pdf" });

      return new NextResponse(pdfBlob, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    } finally {
      await browser.close();
    }
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
