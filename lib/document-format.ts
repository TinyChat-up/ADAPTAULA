export type OutputFormatKey =
  | "ficha"
  | "esquema"
  | "pasos"
  | "resumen"
  | "examen"
  | "lectura";


function stripTags(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeOutputFormat(value: string): OutputFormatKey {
  const lower = (value || "").toLowerCase();
  if (lower.includes("esquema")) return "esquema";
  if (lower.includes("pasos")) return "pasos";
  if (lower.includes("resumen")) return "resumen";
  if (lower.includes("examen")) return "examen";
  if (lower.includes("lectura")) return "lectura";
  return "ficha";
}

function getOutputFormatPromptRules(outputFormat: string) {
  const format = normalizeOutputFormat(outputFormat);

  if (format === "esquema") {
    return `
- Estructura en bloques cortos tipo esquema visual.
- Usa listas breves y títulos de bloque.
- Evita párrafos largos.
- Agrupa ideas clave en tarjetas simples.
`;
  }
  if (format === "pasos") {
    return `
- Organiza el contenido como secuencia de pasos claros.
- Cada paso debe ser corto, accionable y numerado.
- Mantén separación visual entre pasos.
- Si procede, añade un espacio breve de respuesta por paso.
`;
  }
  if (format === "resumen") {
    return `
- Estructura en ideas principales + apoyo.
- Prioriza brevedad y claridad.
- Destaca palabras clave.
- Evita bloques extensos.
`;
  }
  if (format === "examen") {
    return `
- Divide por secciones (por ejemplo: comprensión, vocabulario, aplicación).
- Numera preguntas de forma consistente.
- Añade espacios de respuesta visibles.
- Mantén tono sobrio y claro.
`;
  }
  if (format === "lectura") {
    return `
- Mantén texto muy legible y bien espaciado.
- Usa subtítulos para guiar la lectura.
- Evita densidad excesiva de apoyos visuales.
- Introduce pictogramas solo en puntos de alto valor.
`;
  }
  return `
- Presenta una ficha docente clara y operativa.
- Incluye instrucciones visibles al inicio.
- Separa actividades o preguntas en bloques con aire.
- Añade espacios de respuesta cuando tenga sentido.
`;
}

function ensureFormatWrapper(
  html: string,
  format: OutputFormatKey,
  materialType?: string,
) {
  const trimmed = html.trim();
  if (!trimmed) return trimmed;
  if (/data-aa-doc="1"/i.test(trimmed)) return trimmed;
  const safeMaterial = (materialType || "").trim();
  if (safeMaterial) {
    return `<section data-aa-doc="1" data-aa-format="${format}" data-aa-material="${safeMaterial}">${trimmed}</section>`;
  }
  return `<section data-aa-doc="1" data-aa-format="${format}">${trimmed}</section>`;
}

function normalizeResponseMarkers(html: string) {
  let next = html;
  next = next.replace(
    /(?:\[\s*(?:respuesta|escribe aqui|escribe aquí)\s*\]|_{5,})/gi,
    `<div data-aa-role="response-lines" data-aa-lines="2"></div>`,
  );
  next = next.replace(
    /\[\s*caja de respuesta\s*\]/gi,
    `<div data-aa-role="response-box"></div>`,
  );
  return next;
}

function annotateInstructions(html: string) {
  if (/data-aa-role="instructions"/i.test(html)) return html;
  return html.replace(
    /<p([^>]*)>([\s\S]*?)<\/p>/i,
    (full, attrs, inner) => {
      const text = stripTags(String(inner)).toLowerCase();
      if (
        /instruccion|consigna|objetivo|lee|realiza|completa|responde|marca/.test(text)
      ) {
        return `<div data-aa-role="instructions"><p${attrs}>${inner}</p></div>`;
      }
      return full;
    },
  );
}

function annotateQuestions(html: string) {
  return html
    .replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (full, attrs, inner) => {
      const text = stripTags(String(inner));
      if (/^\d+[.)-]\s+/.test(text) || /\?\s*$/.test(text)) {
        return `<p${attrs} data-aa-role="question">${inner}</p>`;
      }
      return full;
    })
    .replace(/<li([^>]*)>([\s\S]*?)<\/li>/gi, (full, attrs, inner) => {
      const text = stripTags(String(inner));
      if (/^\d+[.)-]\s+/.test(text) || /\?\s*$/.test(text)) {
        return `<li${attrs} data-aa-role="question">${inner}</li>`;
      }
      return full;
    });
}

function annotateByFormat(html: string, format: OutputFormatKey) {
  let next = html;

  if (format === "pasos") {
    next = next.replace(/<(ol|ul)([^>]*)>/gi, `<ol$2 data-aa-role="step-list">`);
    next = next.replace(/<li([^>]*)>/gi, `<li$1 data-aa-role="step-item">`);
  }

  if (format === "esquema") {
    next = next.replace(/<li([^>]*)>/gi, `<li$1 data-aa-role="concept-card">`);
    next = next.replace(/<p([^>]*)>([\s\S]{0,180}?)<\/p>/gi, (full, attrs, inner) => {
      const text = stripTags(String(inner));
      if (text.length > 0 && text.length <= 120) {
        return `<p${attrs} data-aa-role="concept-card">${inner}</p>`;
      }
      return full;
    });
  }

  if (format === "examen" || format === "ficha") {
    if (!/data-aa-role="response-lines"/i.test(next)) {
      next = next.replace(
        /(<p[^>]*data-aa-role="question"[^>]*>[\s\S]*?<\/p>)/gi,
        `$1<div data-aa-role="response-lines" data-aa-lines="2"></div>`,
      );
      next = next.replace(
        /(<li[^>]*data-aa-role="question"[^>]*>[\s\S]*?<\/li>)/gi,
        `$1<div data-aa-role="response-lines" data-aa-lines="2"></div>`,
      );
    }
  }

  return next;
}

function annotateWorksheetSections(html: string) {
  return html
    .replace(/<h2([^>]*)>/gi, `<h2$1 data-aa-role="worksheet-section-title">`)
    .replace(/<h3([^>]*)>/gi, `<h3$1 data-aa-role="worksheet-section-title">`);
}

function annotateWorksheetQuestions(html: string) {
  let next = html;
  next = next.replace(
    /<p([^>]*data-aa-role="question"[^>]*)>/gi,
    `<p$1 data-aa-role="worksheet-question">`,
  );
  next = next.replace(
    /<li([^>]*data-aa-role="question"[^>]*)>/gi,
    `<li$1 data-aa-role="worksheet-question">`,
  );
  return next;
}

function applyWorksheetTemplate(html: string) {
  let next = html;
  next = annotateWorksheetSections(next);
  next = annotateWorksheetQuestions(next);
  if (!/data-aa-role="response-lines"/i.test(next) && !/data-aa-role="response-box"/i.test(next)) {
    next = next.replace(
      /(<p[^>]*data-aa-role="worksheet-question"[^>]*>[\s\S]*?<\/p>)/gi,
      `$1<div data-aa-role="response-lines" data-aa-lines="2"></div>`,
    );
    next = next.replace(
      /(<li[^>]*data-aa-role="worksheet-question"[^>]*>[\s\S]*?<\/li>)/gi,
      `$1<div data-aa-role="response-lines" data-aa-lines="2"></div>`,
    );
  }
  return next;
}

function isWorksheetMaterialType(materialType?: string) {
  const value = (materialType || "").toLowerCase();
  return (
    value === "ficha_trabajo" ||
    value === "metacognicion" ||
    value === "repaso" ||
    value === "examen"
  );
}

export function applyOutputFormatTemplate(params: {
  html: string;
  outputFormat: string;
  materialType?: string;
}) {
  const format = normalizeOutputFormat(params.outputFormat);
  let html = params.html || "";
  html = normalizeResponseMarkers(html);
  html = annotateInstructions(html);
  html = annotateQuestions(html);
  html = annotateByFormat(html, format);
  if (format === "ficha" || format === "examen" || isWorksheetMaterialType(params.materialType)) {
    html = applyWorksheetTemplate(html);
  }
  return ensureFormatWrapper(html, format, params.materialType);
}
