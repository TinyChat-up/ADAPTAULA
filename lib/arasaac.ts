const STOPWORDS_ES = new Set([
  "a",
  "al",
  "algo",
  "algun",
  "alguna",
  "algunas",
  "alguno",
  "algunos",
  "ante",
  "como",
  "con",
  "contra",
  "cual",
  "cuales",
  "de",
  "del",
  "desde",
  "donde",
  "dos",
  "el",
  "ella",
  "ellas",
  "ellos",
  "en",
  "entre",
  "era",
  "erais",
  "eran",
  "eras",
  "eres",
  "es",
  "esa",
  "esas",
  "ese",
  "eso",
  "esos",
  "esta",
  "estaba",
  "estaban",
  "estado",
  "estais",
  "estamos",
  "estan",
  "estar",
  "estas",
  "este",
  "esto",
  "estos",
  "fue",
  "fueron",
  "ha",
  "hace",
  "hacia",
  "han",
  "hasta",
  "hay",
  "la",
  "las",
  "le",
  "les",
  "lo",
  "los",
  "mas",
  "me",
  "mi",
  "mis",
  "mucho",
  "muy",
  "nada",
  "ni",
  "no",
  "nos",
  "nosotros",
  "o",
  "os",
  "otra",
  "otros",
  "para",
  "pero",
  "por",
  "porque",
  "que",
  "quien",
  "quienes",
  "se",
  "ser",
  "si",
  "sin",
  "sobre",
  "su",
  "sus",
  "te",
  "tiene",
  "todo",
  "tu",
  "tus",
  "un",
  "una",
  "uno",
  "unos",
  "y",
  "ya",
]);

const EXCLUDED_PICTOGRAM_TERMS = new Set([
  "piensa",
  "pensar",
  "responde",
  "responder",
  "principales",
  "principal",
  "idea",
  "ideas",
  "concepto",
  "conceptos",
  "actividad",
  "contenido",
  "contenidos",
  "tema",
  "temas",
  "texto",
  "textos",
  "pregunta",
  "preguntas",
  "respuesta",
  "respuestas",
  "explica",
  "explicar",
  "analiza",
  "analizar",
  "reflexiona",
  "reflexionar",
  "comprende",
  "comprender",
  "importante",
  "importantes",
  "general",
  "generales",
]);

export type ArasaacPictogram = {
  concept: string;
  id: number;
  keyword: string;
  imageUrl: string;
};

export type VisualSupportLevel = "bajo" | "medio" | "alto";

const ACTION_HINTS = [
  "lee",
  "leer",
  "escribe",
  "escribir",
  "rodea",
  "subraya",
  "completa",
  "une",
  "observa",
  "ordena",
  "piensa",
  "marca",
  "señala",
  "escucha",
  "habla",
  "responde",
  "identifica",
  "clasifica",
  "corta",
  "pega",
  "colorea",
];

const CONCRETE_CLASSROOM_HINTS = [
  "agua",
  "sol",
  "nube",
  "lluvia",
  "planta",
  "animal",
  "libro",
  "lapiz",
  "lápiz",
  "cuaderno",
  "mesa",
  "silla",
  "casa",
  "escuela",
  "comida",
  "fruta",
  "numero",
  "número",
  "color",
];

const ROUTINE_HINTS = [
  "inicio",
  "primero",
  "despues",
  "luego",
  "final",
  "paso",
  "actividad",
  "objetivo",
  "instruccion",
  "tarea",
  "ejercicio",
];

const GENERIC_NOISE = new Set([
  "actividad",
  "contenido",
  "texto",
  "clase",
  "alumno",
  "alumna",
  "estudiante",
  "profesor",
  "docente",
  "material",
  "pregunta",
  "respuesta",
  "trabajo",
]);

function normalizeConcept(value: string) {
  return normalizeWord(value.trim());
}

function isExcludedConcept(value: string) {
  const normalized = normalizeConcept(value);
  if (!normalized) return true;
  if (STOPWORDS_ES.has(normalized)) return true;
  if (EXCLUDED_PICTOGRAM_TERMS.has(normalized)) return true;
  if (normalized.length < 3) return true;
  return false;
}

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function includesConcept(text: string, concept: string) {
  const normalizedText = normalizeConcept(text);
  const normalizedConcept = normalizeConcept(concept);
  if (!normalizedText || !normalizedConcept) return false;
  return normalizedText.includes(normalizedConcept);
}

function normalizeWord(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function htmlToText(value: string) {
  return value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|ul|ol|section|article|table|tr|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractKeyConcepts(input: string, max = 10) {
  const text = htmlToText(input);
  const tokens =
    text
      .match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}/g)
      ?.map((token) => token.trim())
      .filter(Boolean) || [];

  const frequency = new Map<string, { original: string; count: number }>();
  for (const token of tokens) {
    const normalized = normalizeWord(token);
    if (STOPWORDS_ES.has(normalized)) continue;
    if (normalized.length < 3) continue;
    const existing = frequency.get(normalized);
    if (existing) {
      existing.count += 1;
    } else {
      frequency.set(normalized, { original: token.toLowerCase(), count: 1 });
    }
  }

  return Array.from(frequency.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, max)
    .map(([, value]) => value.original);
}

export function mergePictogramConcepts(params: {
  modelConcepts?: string[];
  sourceText?: string;
  resultText?: string;
  max?: number;
  outputFormat?: string;
  studentProfile?: string;
  workType?: string;
  adaptationType?: string;
  visualSupportLevel?: string;
}) {
  const {
    modelConcepts = [],
    sourceText = "",
    resultText = "",
    max = 10,
    outputFormat = "",
    studentProfile = "",
    workType = "",
    adaptationType = "",
    visualSupportLevel = "medio",
  } = params;

  const maxByLevel = visualSupportLevel === "alto" ? 5 : visualSupportLevel === "bajo" ? 4 : 5;
  const maxByFormat = /examen adaptado/i.test(outputFormat)
    ? 4
    : /pasos secuenciados|esquema visual/i.test(outputFormat)
      ? 5
      : maxByLevel;
  const targetMax = Math.min(max, maxByFormat, 5);

  const profileBoostVisual = /tea|visual|lectora|dislexia|tel|tdl/i.test(studentProfile);
  const adaptationBoostActions = /metodologica|pictograma|instruccion/i.test(adaptationType);
  const workBoostActions = /comprension|expresion|oral|escrita/i.test(workType);

  const cleanedModel = modelConcepts
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 3)
    .filter((item) => !isExcludedConcept(item));

  const extracted = extractKeyConcepts(`${resultText}\n${sourceText}`, targetMax * 3);
  const merged = [...cleanedModel, ...extracted];
  const unique = new Set<string>();
  const candidates: Array<{ concept: string; score: number }> = [];

  for (const item of merged) {
    const normalized = normalizeWord(item);
    if (!normalized || STOPWORDS_ES.has(normalized)) continue;
    if (isExcludedConcept(normalized)) continue;
    if (GENERIC_NOISE.has(normalized)) continue;
    if (unique.has(normalized)) continue;
    unique.add(normalized);

    let score = 0;
    if (cleanedModel.includes(item)) score += 8;
    const inResult = includesConcept(resultText, item);
    const inSource = includesConcept(sourceText, item);
    if (inResult) score += 6;
    if (inSource) score += 3;
    if (ACTION_HINTS.some((hint) => normalized.includes(hint) || hint.includes(normalized))) {
      score += 6;
    }
    if (
      CONCRETE_CLASSROOM_HINTS.some(
        (hint) => normalized.includes(hint) || hint.includes(normalized),
      )
    ) {
      score += 5;
    }
    if (ROUTINE_HINTS.some((hint) => normalized.includes(hint) || hint.includes(normalized))) {
      score += 3;
    }
    if (/cion$|sion$|dad$|mente$/.test(normalized)) {
      score -= 3;
    }
    if (profileBoostVisual) score += 2;
    if (adaptationBoostActions || workBoostActions) score += 1;
    if (normalized.length >= 5 && normalized.length <= 12) score += 1;
    candidates.push({ concept: item, score });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, targetMax)
    .map((item) => item.concept);
}

export async function resolveArasaacPictograms(params: {
  concepts: string[];
  existing?: ArasaacPictogram[];
  maxConcepts?: number;
}) {
  const { concepts, existing = [], maxConcepts = 8 } = params;
  const targetMax = Math.min(maxConcepts, 5);
  const cleaned = concepts
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 3)
    .filter((item) => !isExcludedConcept(item))
    .slice(0, targetMax);

  if (cleaned.length === 0) return [];

  const byConcept = new Map<string, ArasaacPictogram>();
  for (const item of existing) {
    const key = normalizeConcept(item.concept);
    if (!key) continue;
    if (!byConcept.has(key)) byConcept.set(key, item);
  }

  const unresolved = cleaned.filter((concept) => !byConcept.has(normalizeConcept(concept)));
  if (unresolved.length > 0) {
    const responses = await Promise.all(
      unresolved.map(async (concept) => {
        const response = await fetch(
          `/api/arasaac/search?q=${encodeURIComponent(concept)}`,
          { method: "GET" },
        );
        if (!response.ok) return null;
        const payload = (await response.json()) as { items?: ArasaacPictogram[] };
        const first = Array.isArray(payload.items)
          ? payload.items.find((item) => typeof item?.id === "number")
          : null;
        return first || null;
      }),
    );

    for (const item of responses) {
      if (!item) continue;
      const key = normalizeConcept(item.concept);
      if (!key || byConcept.has(key)) continue;
      byConcept.set(key, item);
    }
  }

  return cleaned
    .map((concept) => byConcept.get(normalizeConcept(concept)))
    .filter((item): item is ArasaacPictogram => Boolean(item));
}

function buildInlinePictogramHtml(item: ArasaacPictogram) {
  const concept = escapeAttribute(item.concept);
  const keyword = escapeAttribute(item.keyword || item.concept);
  const imageUrl = escapeAttribute(item.imageUrl);
  return `<span data-aa-picto="1" data-aa-concept="${concept}" data-aa-id="${item.id}" style="display:inline-flex;flex-direction:column;align-items:center;gap:4px;margin-left:8px;padding:6px 8px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;vertical-align:middle;"><img data-aa-pictogram="1" src="${imageUrl}" alt="Pictograma ${keyword}" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="width:44px;height:44px;object-fit:contain;border-radius:8px;background:#fff;" /><span data-aa-role="pictogram-word" style="font-size:10px;line-height:1.1;color:#475569;font-weight:700;">${concept}</span></span>`;
}

function supportConfig(params: {
  outputFormat?: string;
  studentProfile?: string;
  visualSupportLevel?: string;
  adaptationType?: string;
}) {
  const outputFormat = (params.outputFormat || "").toLowerCase();
  const studentProfile = (params.studentProfile || "").toLowerCase();
  const level = (params.visualSupportLevel || "medio").toLowerCase();
  const adaptationType = (params.adaptationType || "").toLowerCase();
  const pictogramMode = adaptationType.includes("pictograma");

  let maxInsertions = level === "alto" ? 16 : level === "bajo" ? 5 : 9;
  let paragraphLimit = level === "alto" ? 180 : level === "bajo" ? 150 : 200;

  if (outputFormat.includes("pasos secuenciados")) maxInsertions += 2;
  if (outputFormat.includes("esquema visual")) maxInsertions += 2;
  if (outputFormat.includes("examen adaptado")) maxInsertions = Math.max(4, maxInsertions - 3);
  if (outputFormat.includes("lectura adaptada")) paragraphLimit += 20;

  if (/tea|apoyo visual/.test(studentProfile)) maxInsertions += 2;
  if (/comprension lectora|dislexia|tel|tdl/.test(studentProfile)) paragraphLimit -= 20;
  if (level === "alto" && /apoyo_visual|visual|tea/.test(studentProfile)) {
    maxInsertions += 5;
    paragraphLimit = Math.min(paragraphLimit, 130);
  }
  if (level === "alto" && pictogramMode) {
    maxInsertions += 10;
    paragraphLimit = Math.min(paragraphLimit, 90);
  }

  return {
    maxInsertions: Math.max(3, maxInsertions),
    paragraphLimit: Math.max(100, paragraphLimit),
    pictogramMode,
  };
}

function scoreBlock(params: {
  tag: "li" | "p";
  text: string;
  outputFormat?: string;
  studentProfile?: string;
}) {
  const { tag, text, outputFormat = "", studentProfile = "" } = params;
  const normalized = normalizeWord(text);
  let score = tag === "li" ? 8 : 4;

  if (ACTION_HINTS.some((hint) => normalized.includes(hint))) score += 6;
  if (ROUTINE_HINTS.some((hint) => normalized.includes(hint))) score += 3;
  if (/^\d+[.)-]/.test(text.trim())) score += 2;
  if (/paso|instruccion|consigna|haz|debes|realiza|completa|lee|escribe/i.test(text)) {
    score += 4;
  }
  if (/esquema visual|pasos secuenciados/i.test(outputFormat) && tag === "li") score += 3;
  if (/tea|apoyo visual/i.test(studentProfile)) score += 2;
  if (text.length > 250) score -= 3;
  return score;
}

function injectPictogramsInTagBlocks(params: {
  html: string;
  tag: "li" | "p";
  pictograms: ArasaacPictogram[];
  insertedByConcept: Set<string>;
  maxInsertions: number;
  currentCount: number;
  paragraphLimit: number;
  outputFormat?: string;
  studentProfile?: string;
}) {
  const {
    html,
    tag,
    pictograms,
    insertedByConcept,
    maxInsertions,
    currentCount,
    paragraphLimit,
    outputFormat,
    studentProfile,
  } = params;
  if (currentCount >= maxInsertions) return { html, count: currentCount };

  let count = currentCount;
  const regex = new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const blocks: Array<{
    fullMatch: string;
    attrs: string;
    inner: string;
    text: string;
    score: number;
  }> = [];

  let match = regex.exec(html);
  while (match) {
    const fullMatch = match[0];
    const attrs = match[1] || "";
    const inner = match[2] || "";
    const text = stripHtml(String(inner));
    if (text) {
      if (!(tag === "p" && text.length > paragraphLimit)) {
        blocks.push({
          fullMatch,
          attrs,
          inner,
          text,
          score: scoreBlock({ tag, text, outputFormat, studentProfile }),
        });
      }
    }
    match = regex.exec(html);
  }

  const sorted = blocks.sort((a, b) => b.score - a.score);
  let updatedHtml = html;

  for (const block of sorted) {
    if (count >= maxInsertions) break;
    if (block.fullMatch.includes('data-aa-picto="1"')) continue;
    if (block.score <= 2) continue;

    const candidate = pictograms.find((item) => {
      const normalized = normalizeConcept(item.concept);
      if (!normalized || insertedByConcept.has(normalized)) return false;
      return includesConcept(block.text, item.concept);
    });
    if (!candidate) continue;

    const replacement = `<${tag}${block.attrs}>${block.inner}${buildInlinePictogramHtml(candidate)}</${tag}>`;
    if (updatedHtml.includes(block.fullMatch)) {
      updatedHtml = updatedHtml.replace(block.fullMatch, replacement);
      insertedByConcept.add(normalizeConcept(candidate.concept));
      count += 1;
    }
  }

  return { html: updatedHtml, count };
}

export function enrichDocumentWithArasaac(params: {
  html: string;
  enabled: boolean;
  pictograms?: ArasaacPictogram[];
  maxInsertions?: number;
  outputFormat?: string;
  studentProfile?: string;
  visualSupportLevel?: string;
  adaptationType?: string;
}) {
  const {
    html,
    enabled,
    pictograms = [],
    maxInsertions,
    outputFormat,
    studentProfile,
    visualSupportLevel = "medio",
    adaptationType,
  } = params;

  if (!enabled) {
    return html;
  }
  if (!html.trim()) return html;
  if (html.includes('data-aa-picto="1"') || html.includes('data-aa-pictogram-board="1"')) return html;
  if (pictograms.length === 0) return html;

  const cfg = supportConfig({
    outputFormat,
    studentProfile,
    visualSupportLevel,
    adaptationType,
  });
  const finalMaxInsertions = typeof maxInsertions === "number" ? maxInsertions : cfg.maxInsertions;
  const level = (visualSupportLevel || "medio").toLowerCase();
  const highVisualMode = level === "alto";
  const strictHighVisualMode = highVisualMode && cfg.pictogramMode;

  const insertedByConcept = new Set<string>();
  const firstPass = injectPictogramsInTagBlocks({
    html,
    tag: "li",
    pictograms,
    insertedByConcept,
    maxInsertions: finalMaxInsertions,
    currentCount: 0,
    paragraphLimit: cfg.paragraphLimit,
    outputFormat,
    studentProfile,
  });
  const secondPass = injectPictogramsInTagBlocks({
    html: firstPass.html,
    tag: "p",
    pictograms,
    insertedByConcept,
    maxInsertions: highVisualMode ? firstPass.count : finalMaxInsertions,
    currentCount: firstPass.count,
    paragraphLimit: cfg.paragraphLimit,
    outputFormat,
    studentProfile,
  });
  const boardItems = pictograms
    .slice(0, strictHighVisualMode ? 24 : highVisualMode ? 14 : 8)
    .map((item) => {
      const concept = escapeAttribute(item.concept);
      const keyword = escapeAttribute(item.keyword || item.concept);
      const imageUrl = escapeAttribute(item.imageUrl);
      return `<div data-aa-role="pictogram-card" data-aa-concept="${concept}">
<img data-aa-pictogram="1" src="${imageUrl}" alt="Pictograma ${keyword}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
<span data-aa-role="pictogram-word">${concept}</span>
</div>`;
    })
    .join("");
  const boardHtml = `<section data-aa-pictogram-board="1" data-aa-level="${level}" data-aa-mode="${cfg.pictogramMode ? "pictogramas" : "general"}">
<h3>Apoyos visuales</h3>
<div data-aa-role="pictogram-grid">${boardItems}</div>
</section>`;

  if (cfg.pictogramMode) {
    return secondPass.html;
  }

  const withBoard = secondPass.html.includes("<h2")
    ? secondPass.html.replace(/<h2[^>]*>/i, `${boardHtml}<h2`)
    : `${boardHtml}${secondPass.html}`;

  return withBoard;
}
