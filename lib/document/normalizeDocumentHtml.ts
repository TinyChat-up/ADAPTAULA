// lib/document/normalizeDocumentHtml.ts
//
// Capa ligera de normalización estructural del HTML generado por la IA.
//
// FILOSOFÍA (inspirada en Pretext):
//   "Preparar el texto antes de maquetarlo, no después."
//   En lugar de depender de que el modelo produzca estructura perfecta,
//   aplicamos un postproceso determinista que:
//   - consolida bloques semánticamente
//   - corrige problemas estructurales típicos de la IA
//   - mejora legibilidad sin tocar el contenido curricular
//
// REGLAS DE SEGURIDAD:
//   - Solo opera sobre patrones HTML bien delimitados y seguros
//   - Nunca modifica texto pedagógico (contenido entre etiquetas)
//   - Falla silenciosamente: si algo lanza, devuelve el original intacto
//   - Sin dependencias externas — solo string operations + regex seguros
//
// PIPELINE:
//   sanitizeHtml(rawHtml)          ← seguridad (route.ts)
//   normalizeDocumentHtml(html)    ← estructura (este módulo)
//   injectCssIntoHtml(html, css)   ← presentación (buildDocumentCss.ts)

// ─── Tipos de configuración de normalización ──────────────────────────────────

export interface NormalizeOptions {
  /** Asignatura del documento. Si se proporciona, se añade data-subject al aa-body. */
  subject?: string;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Aplica 5 normalizaciones conservadoras al HTML del documento adaptado.
 * Siempre devuelve un string — nunca lanza excepciones.
 */
export function normalizeDocumentHtml(
  html: string,
  opts: NormalizeOptions = {},
): string {
  try {
    let result = html;

    // 1. <br><br> → separación de párrafo (problema frecuente en output de IA)
    result = normalizeBrSequences(result);

    // 2. Párrafos de solo texto demasiado largos → dividir en dos
    result = splitLongParagraphs(result);

    // 3. .aa-block sin data-block → añadir atributo requerido para animaciones
    result = ensureDataBlockAttributes(result);

    // 4. Imágenes de pictograma → añadir loading="lazy" (rendimiento)
    result = addLazyLoadingToPictograms(result);

    // 5. Añadir data-subject al aa-body si se proporciona la asignatura
    if (opts.subject) {
      result = injectSubjectAttribute(result, opts.subject);
    }

    return result;
  } catch {
    // Fallback silencioso: si algo falla de forma inesperada, el pipeline
    // continúa con el HTML original sin la mejora estructural.
    return html;
  }
}

// ─── Transformación 1: <br><br> → párrafos ───────────────────────────────────

/**
 * Reemplaza secuencias de 2+ <br> consecutivos por cierre + apertura de <p>.
 * La IA a veces usa <br><br> para separar párrafos en lugar de </p><p>.
 * Elimina los <p></p> vacíos que pueden quedar después del reemplazo.
 *
 * Seguro: no opera sobre contenido semántico, solo sobre markup de separación.
 */
function normalizeBrSequences(html: string): string {
  return html
    // 2+ <br> consecutivos (con espacios opcionales entre ellos) → cierre/apertura de p
    .replace(/(<br\s*\/?>)(\s*<br\s*\/?>)+/gi, "</p><p>")
    // Eliminar párrafos vacíos resultantes
    .replace(/<p>\s*<\/p>/g, "");
}

// ─── Transformación 2: dividir párrafos largos ────────────────────────────────

// Umbral: párrafos de texto puro (sin HTML interior) más largos que esto
const SPLIT_MIN_LENGTH = 250;
// El primer punto de corte debe estar al menos a esta distancia del inicio
// (evita cortar en abreviaturas cortas como "Dr." o "pág.")
const SPLIT_MIN_OFFSET = 100;
// El resto tras el corte debe tener al menos esta longitud para ser válido
const SPLIT_MIN_REST = 40;

/**
 * Divide párrafos muy largos de texto puro en dos párrafos al primer límite
 * de frase seguro encontrado después de SPLIT_MIN_OFFSET caracteres.
 *
 * Solo opera sobre <p> sin etiquetas HTML interiores (sin pictogramas, sin spans).
 * Hace un único corte — no recursivo — para minimizar el riesgo de fragmentación.
 *
 * Seguro: el regex [^<]{250,} garantiza que no hay etiquetas HTML dentro.
 */
function splitLongParagraphs(html: string): string {
  // [^<]{250,} → solo texto puro, al menos 250 caracteres
  return html.replace(/<p>([^<]{250,})<\/p>/g, (match, text) => {
    const trimmed = text.trim();

    // Buscar el primer límite de frase seguro: puntuación seguida de espacio
    // y letra mayúscula (incluye acentuadas y ¿ ¡ de inicio español)
    const boundary = /[.!?]\s+(?=[A-ZÁÉÍÓÚÑÜ¿¡])/g;
    let m: RegExpExecArray | null;

    while ((m = boundary.exec(trimmed)) !== null) {
      const cutAt = m.index + 1; // justo después del signo de puntuación

      if (cutAt < SPLIT_MIN_OFFSET) continue; // demasiado cerca del inicio

      const first = trimmed.slice(0, cutAt).trim();
      const rest  = trimmed.slice(cutAt).trim();

      if (!first || rest.length < SPLIT_MIN_REST) continue; // resto demasiado corto

      // Un solo corte conservador
      return `<p>${first}</p>\n<p>${rest}</p>`;
    }

    // No se encontró un punto de corte seguro → devolver sin cambios
    return match;
  });
}

// ─── Transformación 3: data-block en .aa-block ───────────────────────────────

/**
 * Añade data-block="bloque-N" a los elementos .aa-block que no lo tengan.
 * El atributo data-block es requerido por page.tsx para las animaciones de
 * entrada (IntersectionObserver que añade la clase .visible).
 *
 * Seguro: solo añade un atributo — no modifica el contenido ni la estructura.
 */
function ensureDataBlockAttributes(html: string): string {
  let counter = 0;

  // Captura el div de apertura que tenga clase aa-block (con o sin clases adicionales)
  return html.replace(
    /<div([^>]*\bclass="[^"]*\baa-block\b[^"]*"[^>]*)>/g,
    (match, attrs) => {
      if (attrs.includes("data-block")) return match; // ya tiene el atributo
      counter++;
      return `<div${attrs} data-block="bloque-${counter}">`;
    },
  );
}

// ─── Transformación 4: lazy loading en pictogramas ───────────────────────────

/**
 * Añade loading="lazy" a las imágenes de pictograma (aa-picto-img, aa-picto-inline).
 * Mejora el tiempo de carga inicial en documentos con muchos pictogramas.
 *
 * Seguro: solo añade un atributo HTML estándar que el navegador puede ignorar.
 */
function addLazyLoadingToPictograms(html: string): string {
  return html.replace(
    /<img\s+class="(aa-picto-img|aa-picto-inline)"([^>]*)>/g,
    (match, cls, rest) => {
      if (rest.includes("loading=")) return match; // ya tiene el atributo
      return `<img class="${cls}"${rest} loading="lazy">`;
    },
  );
}

// ─── Transformación 5: data-subject en aa-body ───────────────────────────────

/**
 * Añade data-subject="<subject>" al primer .aa-body del documento.
 * Habilita overrides CSS por asignatura (Sprint E.3) sin modificar la estructura.
 * Ej: .aa-body[data-subject="matematicas"] .aa-equation-block { ... }
 *
 * Seguro: atributo informativo, sin efecto funcional si no hay CSS que lo use.
 */
function injectSubjectAttribute(html: string, subject: string): string {
  // Solo la primera ocurrencia (un documento tiene un solo aa-body)
  return html.replace(
    /<div\s+class="aa-body">/,
    `<div class="aa-body" data-subject="${subject}">`,
  );
}
