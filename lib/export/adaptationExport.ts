import { createClient } from "@supabase/supabase-js";

export type ExportPictogram = {
  concept: string;
  id: number;
  keyword: string;
  imageUrl: string;
};

export type ExportContentBlock = {
  kind:
    | "h1"
    | "h2"
    | "h3"
    | "p"
    | "li"
    | "section_title"
    | "question"
    | "instructions"
    | "response_lines"
    | "response_box";
  text: string;
  pictograms: ExportPictogram[];
  responseLines?: number;
};

export type ExportAdaptationData = {
  id: string;
  title: string;
  outputFormat: string;
  adaptationType: string;
  studentProfile: string;
  styleName: string;
  versionNumber: number;
  createdAt: string;
  contentHtml: string;
  contentPlain: string;
  pictogramData: ExportPictogram[];
  aiNotes: string;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parsePictogramData(value: unknown): ExportPictogram[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const concept = asString(item.concept);
      const id = typeof item.id === "number" ? item.id : Number(item.id || 0);
      const keyword = asString(item.keyword) || concept;
      const imageUrl = asString(item.imageUrl);
      if (!concept || !id || !imageUrl) return null;
      return { concept, id, keyword, imageUrl } satisfies ExportPictogram;
    })
    .filter((item): item is ExportPictogram => Boolean(item));
}

function normalizeWord(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function includesConcept(text: string, concept: string) {
  const t = normalizeWord(text);
  const c = normalizeWord(concept);
  return Boolean(t && c && t.includes(c));
}

function parseInlinePictograms(innerHtml: string): {
  cleanedInnerHtml: string;
  pictograms: ExportPictogram[];
} {
  const pictograms: ExportPictogram[] = [];
  const spanRegex = /<span[^>]*data-aa-picto="1"[^>]*>([\s\S]*?)<\/span>/gi;

  const cleanedInnerHtml = innerHtml.replace(spanRegex, (fullMatch) => {
    const conceptMatch = fullMatch.match(/data-aa-concept="([^"]+)"/i);
    const idMatch = fullMatch.match(/data-aa-id="([^"]+)"/i);
    const srcMatch = fullMatch.match(/<img[^>]*src="([^"]+)"/i);
    const altMatch = fullMatch.match(/<img[^>]*alt="([^"]+)"/i);

    const concept = decodeHtmlEntities(conceptMatch?.[1] || "").trim();
    const id = Number(idMatch?.[1] || 0);
    const imageUrl = srcMatch?.[1] || "";
    const keyword = decodeHtmlEntities(altMatch?.[1] || concept).trim();

    if (concept && id && imageUrl) {
      pictograms.push({
        concept,
        id,
        keyword: keyword || concept,
        imageUrl,
      });
    }

    return "";
  });

  return { cleanedInnerHtml, pictograms };
}

function stripHtml(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h1|h2|h3|li|ul|ol|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

export function parseStructuredContentForExport(params: {
  contentHtml: string;
  contentPlain: string;
  pictogramData: ExportPictogram[];
}) {
  const { contentHtml, contentPlain, pictogramData } = params;
  const blocks: ExportContentBlock[] = [];
  const tagRegex = /<(h1|h2|h3|p|li|div|section|article)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match = tagRegex.exec(contentHtml);

  while (match) {
    const tagName = (match[1] || "p").toLowerCase();
    const attrs = match[2] || "";
    const inner = match[3] || "";
    let kind: ExportContentBlock["kind"] =
      tagName === "h1" || tagName === "h2" || tagName === "h3" || tagName === "li"
        ? (tagName as ExportContentBlock["kind"])
        : "p";

    if (/data-aa-role="instructions"/i.test(attrs)) {
      kind = "instructions";
    } else if (/data-aa-role="worksheet-section-title"/i.test(attrs)) {
      kind = "section_title";
    } else if (
      /data-aa-role="worksheet-question"/i.test(attrs) ||
      /data-aa-role="question"/i.test(attrs)
    ) {
      kind = "question";
    } else if (/data-aa-role="response-lines"/i.test(attrs)) {
      const linesMatch = attrs.match(/data-aa-lines="(\d+)"/i);
      blocks.push({
        kind: "response_lines",
        text: "",
        pictograms: [],
        responseLines: Math.max(1, Number(linesMatch?.[1] || 2)),
      });
      match = tagRegex.exec(contentHtml);
      continue;
    } else if (/data-aa-role="response-box"/i.test(attrs)) {
      blocks.push({
        kind: "response_box",
        text: "",
        pictograms: [],
      });
      match = tagRegex.exec(contentHtml);
      continue;
    }

    const { cleanedInnerHtml, pictograms } = parseInlinePictograms(inner);
    const text = stripHtml(cleanedInnerHtml);
    if (text) {
      blocks.push({
        kind,
        text,
        pictograms,
      });
    }
    match = tagRegex.exec(contentHtml);
  }

  if (blocks.length === 0) {
    const fallbackBlocks = splitParagraphs(contentPlain).map((paragraph) => {
      const line = paragraph.trim();
      let kind: ExportContentBlock["kind"] = "p";
      let text = line;
      if (line.startsWith("### ")) {
        kind = "h3";
        text = line.replace(/^###\s+/, "");
      } else if (line.startsWith("## ")) {
        kind = "h2";
        text = line.replace(/^##\s+/, "");
      } else if (line.startsWith("# ")) {
        kind = "h1";
        text = line.replace(/^#\s+/, "");
      } else if (line.startsWith("- ")) {
        kind = "li";
        text = line.replace(/^-+\s+/, "");
      }
      return { kind, text, pictograms: [] } satisfies ExportContentBlock;
    });
    return fallbackBlocks;
  }

  if (pictogramData.length > 0) {
    for (const block of blocks) {
      if (block.pictograms.length > 0) continue;
      const fallback = pictogramData.find((item) => includesConcept(block.text, item.concept));
      if (fallback) {
        block.pictograms.push(fallback);
      }
    }
  }

  return blocks;
}

export function detectImageMimeType(url: string, contentType: string) {
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes("png")) return "png" as const;
  if (lowerType.includes("jpeg") || lowerType.includes("jpg")) return "jpg" as const;
  if (url.toLowerCase().endsWith(".jpg") || url.toLowerCase().endsWith(".jpeg")) {
    return "jpg" as const;
  }
  return "png" as const;
}

export async function fetchPictogramAsset(url: string) {
  const response = await fetch(url, { method: "GET", cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`No se pudo descargar pictograma (${response.status}).`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: new Uint8Array(arrayBuffer),
    mimeType: detectImageMimeType(url, response.headers.get("content-type") || ""),
  };
}

export function toSafeSlug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function htmlToPlainText(value: string) {
  return value
    .replace(/<\s*h1[^>]*>/gi, "\n# ")
    .replace(/<\s*h2[^>]*>/gi, "\n## ")
    .replace(/<\s*h3[^>]*>/gi, "\n### ")
    .replace(/<\/\s*h1>/gi, "\n")
    .replace(/<\/\s*h2>/gi, "\n")
    .replace(/<\/\s*h3>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*li>/gi, "\n")
    .replace(/<\s*tr[^>]*>/gi, "\n")
    .replace(/<\/\s*tr>/gi, "\n")
    .replace(/<\s*td[^>]*>/gi, " | ")
    .replace(/<\s*th[^>]*>/gi, " | ")
    .replace(/<\/\s*td>/gi, "")
    .replace(/<\/\s*th>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|ul|ol|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitParagraphs(content: string) {
  return content
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

export async function loadAdaptationForExport(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return { error: "No autenticado.", status: 401 as const };
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const userResult = await supabase.auth.getUser(token);
  if (userResult.error || !userResult.data.user) {
    return { error: "Sesión inválida.", status: 401 as const };
  }

  const { adaptationId } = (await req.json()) as { adaptationId?: string };
  if (!adaptationId) {
    return { error: "Falta adaptationId.", status: 400 as const };
  }

  const adaptationResult = await supabase
    .from("adaptations")
    .select(
      "id, title, content_type, adaptation_type, student_profile, style_snapshot, style_id, result_html, adapted_content, pictogram_data, ai_notes, version_number, created_at",
    )
    .eq("id", adaptationId)
    .eq("user_id", userResult.data.user.id)
    .maybeSingle();

  if (adaptationResult.error) {
    return { error: adaptationResult.error.message, status: 500 as const };
  }

  if (!adaptationResult.data) {
    return { error: "Adaptación no encontrada.", status: 404 as const };
  }

  const row = adaptationResult.data as Record<string, unknown>;
  const title = asString(row.title) || "Adaptación";
  const outputFormat = asString(row.content_type) || "Material adaptado";
  const adaptationType = asString(row.adaptation_type) || "No definido";
  const studentProfile = asString(row.student_profile) || "No definido";
  const versionNumber = Number(row.version_number || 1) || 1;
  const createdAt = asString(row.created_at);
  const aiNotes = asString(row.ai_notes);
  const snapshot =
    row.style_snapshot && typeof row.style_snapshot === "object"
      ? (row.style_snapshot as Record<string, unknown>)
      : null;
  const styleName =
    (snapshot && asString(snapshot.name)) ||
    (asString(row.style_id) ? "Estilo aplicado" : "");

  const contentRaw =
    asString(row.result_html) || asString(row.adapted_content) || "";
  const contentPlain = htmlToPlainText(contentRaw);
  const pictogramData = parsePictogramData(row.pictogram_data);

  if (!contentPlain) {
    return {
      error: "La adaptación no tiene contenido exportable.",
      status: 400 as const,
    };
  }

  const adaptation: ExportAdaptationData = {
    id: asString(row.id),
    title,
    outputFormat,
    adaptationType,
    studentProfile,
    styleName,
    versionNumber,
    createdAt,
    contentHtml: contentRaw,
    contentPlain,
    pictogramData,
    aiNotes,
  };

  return { adaptation, status: 200 as const };
}
