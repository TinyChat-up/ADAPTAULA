export type DocumentSchemaBlockType =
  | "header"
  | "title"
  | "section"
  | "question"
  | "response_lines"
  | "response_box"
  | "bullet_list"
  | "paragraph";

export type DocumentSchemaBlock = {
  type: DocumentSchemaBlockType;
  text?: string;
  level?: number;
  items?: string[];
  lines?: number;
};

export type DocumentSchema = {
  materialType:
    | "ficha_trabajo"
    | "esquema"
    | "examen"
    | "repaso"
    | "metacognicion"
    | "lectura_adaptada";
  blocks: DocumentSchemaBlock[];
  stats: {
    sectionCount: number;
    questionCount: number;
    listCount: number;
    responseLinesCount: number;
  };
};

function cleanLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function detectMaterialType(text: string, outputFormat?: string): DocumentSchema["materialType"] {
  const fromFormat = (outputFormat || "").toLowerCase();
  if (fromFormat.includes("examen")) return "examen";
  if (fromFormat.includes("lectura")) return "lectura_adaptada";
  if (fromFormat.includes("esquema")) return "esquema";

  const lower = text.toLowerCase();
  if (/examen|evalua|evaluaci[oó]n|punt[úu]a/.test(lower)) return "examen";
  if (/repaso|recuerda|repasad/.test(lower)) return "repaso";
  if (/metacognici[oó]n|piensa sobre|autoevaluaci[oó]n/.test(lower)) return "metacognicion";
  if (/lectura|texto base|comprensi[oó]n lectora/.test(lower)) return "lectura_adaptada";
  if (/esquema|mapa|conceptos clave/.test(lower)) return "esquema";
  return "ficha_trabajo";
}

export function analyzeDocumentStructure(text: string, outputFormat?: string): DocumentSchema {
  const lines = text
    .split("\n")
    .map((line) => cleanLine(line))
    .filter(Boolean);

  const blocks: DocumentSchemaBlock[] = [];
  let titleTaken = false;
  let pendingList: string[] = [];

  const flushList = () => {
    if (pendingList.length === 0) return;
    blocks.push({
      type: "bullet_list",
      items: [...pendingList],
    });
    pendingList = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!titleTaken && line.length > 0 && line.length <= 90) {
      blocks.push({ type: "title", text: line, level: 1 });
      titleTaken = true;
      continue;
    }

    if (/^[_-]{4,}$/.test(line) || /escribe aqu[ií]|respuesta:/i.test(line)) {
      flushList();
      blocks.push({ type: "response_lines", lines: 2 });
      continue;
    }
    if (/^\s*\[[^\]]*caja[^\]]*\]\s*$/i.test(line)) {
      flushList();
      blocks.push({ type: "response_box" });
      continue;
    }
    if (/^(\d+[.)-]\s+).+/.test(line) || /\?\s*$/.test(line)) {
      flushList();
      blocks.push({ type: "question", text: line });
      continue;
    }
    if (/^[-*•]\s+.+/.test(line)) {
      pendingList.push(line.replace(/^[-*•]\s+/, "").trim());
      continue;
    }
    if (/^(##?\s+|[A-ZÁÉÍÓÚÜÑ][^.!?]{2,}:)$/.test(line)) {
      flushList();
      blocks.push({
        type: "section",
        text: line.replace(/^##?\s+/, "").replace(/:$/, ""),
        level: 2,
      });
      continue;
    }

    flushList();
    blocks.push({ type: "paragraph", text: line });
  }

  flushList();

  const stats = {
    sectionCount: blocks.filter((b) => b.type === "section").length,
    questionCount: blocks.filter((b) => b.type === "question").length,
    listCount: blocks.filter((b) => b.type === "bullet_list").length,
    responseLinesCount: blocks.filter((b) => b.type === "response_lines").length,
  };

  return {
    materialType: detectMaterialType(text, outputFormat),
    blocks: blocks.slice(0, 80),
    stats,
  };
}

export function schemaToPromptBlock(schema: DocumentSchema | null) {
  if (!schema) return "";
  return [
    `Tipo de material detectado: ${schema.materialType}`,
    `Resumen estructural: secciones=${schema.stats.sectionCount}, preguntas=${schema.stats.questionCount}, listas=${schema.stats.listCount}, lineas_respuesta=${schema.stats.responseLinesCount}`,
    `Bloques (orden original): ${JSON.stringify(schema.blocks.slice(0, 40))}`,
    "Instrucción: conserva este orden y tipo de bloque al adaptar contenido.",
  ].join("\n");
}

