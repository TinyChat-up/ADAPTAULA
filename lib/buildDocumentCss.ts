// lib/buildDocumentCss.ts
// CSS del documento AdaptAula generado server-side.
// Se inyecta DESPUÉS de la llamada a Gemini — nunca dentro del prompt.
// Ahorro: ~550 tokens por llamada de adaptación.

import type { AdaptationConfig } from "@/lib/adaptationRules";

interface WritingMetrics {
  lineHeight: string;
  boxMinHeight: string;
  fontSize: string;
  lineSpacing: string;
}

export function buildDocumentCss(
  config: AdaptationConfig,
  writingMetrics: WritingMetrics,
  subject?: string,
): string {
  const isDislexia = config.learningProfile === "dislexia";

  const lineH = writingMetrics.lineHeight;
  const lineHpx = parseInt(lineH);
  const midLine = Math.round(lineHpx * 0.45) + "px";
  const topLine = Math.round(lineHpx * 0.20) + "px";

  // Fondo del body según perfil:
  // dislexia → crema (#FFF8E7), TEA → neutro suave (#FAFAF5), resto → cálido (#F5F0E8)
  const bodyBg =
    isDislexia ? "#FFF8E7" :
    config.learningProfile === "tea" ? "#FAFAF5" :
    "#F5F0E8";

  // Fondo de tarjeta de actividad
  const activityBg = isDislexia ? "#FBF8F0" : "#FFFDF7";

  const baseCss = `
/* ── Reset ── */
*{box-sizing:border-box;margin:0;padding:0}

/* ── Página ── */
body{background:${bodyBg};padding:32px 16px;font-family:'Arial',sans-serif}
.aa-page{
  max-width:760px;
  margin:0 auto;
  background:#FFFEF9;
  border-radius:12px;
  box-shadow:0 4px 24px rgba(80,60,20,0.10);
  overflow:hidden;
}

/* ── Cabecera del documento ── */
.aa-header{
  background:linear-gradient(135deg,#4A7C59 0%,#5B9B6F 100%);
  padding:28px 48px 24px;
  border-bottom:4px solid #E8842A;
}
.aa-header h1{
  font-size:24px;
  font-weight:700;
  color:white;
  letter-spacing:0.3px;
  margin-bottom:4px;
}
.aa-header .aa-meta{
  font-size:12px;
  color:rgba(255,255,255,0.75);
  font-weight:400;
}

/* ── Cuerpo ── */
.aa-body{padding:40px 48px}

/* ── Bloque genérico con animación de entrada ── */
.aa-block{
  margin-bottom:32px;
  opacity:0;
  transform:translateY(12px);
  transition:opacity 0.4s ease, transform 0.4s ease;
}
.aa-block.visible{
  opacity:1;
  transform:translateY(0);
}

/* ── Subtítulo de sección de lectura ── */
.aa-subtitle{
  display:block;
  font-size:13px;
  font-weight:700;
  color:#3D6B4A;
  background:#EBF5EE;
  border-left:3px solid #2D5A3D;
  padding:7px 14px;
  border-radius:0 6px 6px 0;
  margin:0 0 12px;
}

/* ── Párrafos de lectura ── */
.aa-reading-block p{
  font-size:${writingMetrics.fontSize};
  line-height:1.85;
  color:#2D2D2D;
  margin-bottom:12px;
  ${isDislexia ? "letter-spacing:0.05em;word-spacing:0.16em;" : ""}
}

/* ── Separador lectura / actividades ── */
.aa-separator{
  border:none;
  height:3px;
  background:linear-gradient(90deg,#5B9B6F,#E8842A,#5B9B6F);
  border-radius:2px;
  margin:40px 0;
}

/* ── Título sección actividades ── */
.aa-section-title{
  font-size:11px;
  font-weight:700;
  color:#E8842A;
  text-transform:uppercase;
  letter-spacing:2.5px;
  padding-bottom:10px;
  border-bottom:2px solid #F5D9B8;
  margin-bottom:28px;
}

/* ── Tarjeta de actividad ── */
.aa-activity{
  background:${activityBg};
  border:1.5px solid #C4A882;
  border-radius:12px;
  padding:24px 28px;
  border-top:4px solid #E8842A;
}

/* ── Número de actividad ── */
.aa-activity-number{
  display:inline-block;
  font-size:10px;
  font-weight:700;
  color:white;
  background:#E8842A;
  text-transform:uppercase;
  letter-spacing:2px;
  padding:3px 10px;
  border-radius:20px;
  margin-bottom:14px;
}

/* ── Instrucción de actividad ── */
.aa-instruction{
  font-size:${writingMetrics.fontSize};
  font-weight:700;
  color:#2D2D2D;
  line-height:1.65;
  margin-bottom:16px;
}

/* ── Sub-pregunta ── */
.aa-sub-question{
  font-size:14px;
  color:#3D3D3D;
  line-height:1.7;
  margin:14px 0 6px;
  font-weight:500;
}

/* ── DOBLE PAUTA ── */
.aa-ruled-line{
  position:relative;
  width:100%;
  height:${lineH};
  margin:6px 0 18px;
  background:
    linear-gradient(#9DD4B0 1px, transparent 1px) 0 ${topLine} / 100% 1px no-repeat,
    linear-gradient(#7AB893 1.5px, transparent 1.5px) 0 ${midLine} / 100% 1.5px no-repeat,
    linear-gradient(#2D5A3D 2px, transparent 2px) 0 calc(${lineH} - 2px) / 100% 2px no-repeat,
    #F8FDF9;
  border-radius:3px;
}

/* ── CAJA CON PAUTA INTERIOR ── */
.aa-ruled-box{
  width:100%;
  min-height:${writingMetrics.boxMinHeight};
  border:1.5px solid #8BB89A;
  border-radius:10px;
  background:
    repeating-linear-gradient(
      #FFFDF7,
      #FFFDF7 calc(${writingMetrics.lineSpacing} - 2px),
      #8BB89A calc(${writingMetrics.lineSpacing} - 2px),
      #8BB89A calc(${writingMetrics.lineSpacing} - 1px),
      #FFFDF7 calc(${writingMetrics.lineSpacing} - 1px),
      #FFFDF7 calc(${writingMetrics.lineSpacing})
    );
  background-color:#FFFDF7;
  margin:8px 0 18px;
  padding:8px 12px 0;
  overflow:hidden;
}
.aa-ruled-box--large{
  min-height:calc(${writingMetrics.boxMinHeight} * 1.8);
}
.aa-ruled-box--correction{
  min-height:${lineH};
}

/* ── Inicio de respuesta dado ── */
.aa-starter{
  display:block;
  color:#9B8B6E;
  font-style:italic;
  font-size:14px;
  padding:6px 4px 0;
}

/* ── Etiqueta de corrección ── */
.aa-correction-label{
  font-size:12px;
  color:#7B6B4E;
  margin:8px 0 4px;
  font-style:italic;
}

/* ── Ítem V/F ── */
.aa-vf-item{margin-bottom:24px}
.aa-check-row{display:flex;gap:20px;margin:8px 0 6px;flex-wrap:wrap}
.aa-check-option{
  display:flex;
  align-items:center;
  gap:8px;
  font-size:14px;
  font-weight:600;
  color:#2D2D2D;
  cursor:pointer;
}
.aa-checkbox{
  width:22px;
  height:22px;
  border:2.5px solid #5B9B6F;
  border-radius:5px;
  flex-shrink:0;
  display:inline-block;
  background:white;
}

/* ── Tabla de completar ── */
.aa-table{width:100%;border-collapse:separate;border-spacing:0 6px;margin:12px 0}
.aa-cell-label{
  width:35%;
  padding:6px 12px 6px 4px;
  font-size:14px;
  font-weight:600;
  color:#2D2D2D;
  vertical-align:bottom;
  white-space:nowrap;
}
.aa-cell-ruled{
  position:relative;
  height:${lineH};
  background:
    linear-gradient(#9DD4B0 1px, transparent 1px) 0 ${topLine} / 100% 1px no-repeat,
    linear-gradient(#7AB893 1.5px, transparent 1.5px) 0 ${midLine} / 100% 1.5px no-repeat,
    linear-gradient(#2D5A3D 2px, transparent 2px) 0 calc(${lineH} - 2px) / 100% 2px no-repeat,
    #F8FDF9;
  border-radius:3px;
}

/* ── Ejemplo resuelto ── */
.aa-example{
  background:#FFF8ED;
  border-left:4px solid #E8842A;
  border-radius:0 8px 8px 0;
  padding:12px 16px;
  margin:0 0 18px;
  font-size:14px;
  color:#7A4E1A;
}
.aa-example::before{content:"Ejemplo: ";font-weight:700}

/* ── PICTOGRAMAS MODO TARJETA (apoyo alto) ── */
.aa-picto-row{
  display:flex;
  flex-wrap:wrap;
  gap:12px;
  margin:12px 0 18px;
}
.aa-picto-card{
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:6px;
  background:#F0F9F2;
  border:1.5px solid #A8D5B5;
  border-radius:10px;
  padding:10px 14px 8px;
  min-width:80px;
}
.aa-picto-img{
  width:64px;
  height:64px;
  object-fit:contain;
}
.aa-picto-word{
  font-size:12px;
  font-weight:700;
  color:#3D6B4A;
  text-align:center;
  text-transform:lowercase;
}

/* ── PICTOGRAMAS MODO INLINE (apoyo bajo/medio) ── */
.aa-picto-inline{
  width:40px;
  height:40px;
  object-fit:contain;
  vertical-align:middle;
  margin:0 3px;
  display:inline;
}

/* ── Casilla de completado TDAH ── */
.aa-done-row{
  display:flex;
  align-items:center;
  gap:10px;
  margin-top:18px;
  padding-top:12px;
  border-top:1.5px dashed #C8D9C0;
  font-size:13px;
  color:#7B8B7E;
}

/* ── CAJA DE CÁLCULO (para ecuaciones y operaciones) ── */
.aa-calc-box{
  width:100%;
  min-height:100px;
  border:2px solid #2D5A3D;
  border-radius:10px;
  background:#F8FDF9;
  margin:8px 0 20px;
  padding:12px 16px;
  position:relative;
}
.aa-calc-box::before{
  content:"Desarrollo:";
  display:block;
  font-size:11px;
  font-weight:700;
  color:#2D5A3D;
  text-transform:uppercase;
  letter-spacing:1.5px;
  margin-bottom:8px;
}

/* ── LÍNEA DE SOLUCIÓN (x = ___) ── */
.aa-solution-line{
  display:flex;
  align-items:center;
  gap:12px;
  margin:4px 0 20px;
  font-size:16px;
  font-weight:700;
  color:#2D2D2D;
}
.aa-solution-line::before{
  content:"x =";
  font-weight:700;
  color:#E8842A;
  font-size:18px;
  min-width:32px;
}
.aa-solution-line .aa-solution-blank{
  flex:1;
  height:44px;
  border-bottom:3px solid #2D5A3D;
  background:transparent;
}

/* ── BLOQUE DE ECUACIÓN individual ── */
.aa-equation-block{
  background:white;
  border:1.5px solid #C4A882;
  border-left:5px solid #E8842A;
  border-radius:0 10px 10px 0;
  padding:14px 18px;
  margin:0 0 16px;
  font-size:17px;
  font-weight:600;
  color:#1A1A1A;
}

/* ── CAJA DE CONCEPTO (definición o término clave) ── */
.aa-concept-box{
  display:flex;
  flex-direction:column;
  border:2px solid #4A7C59;
  border-left:5px solid #4A7C59;
  border-radius:0 10px 10px 0;
  padding:12px 16px;
  margin:10px 0 18px;
  background:#F0F7F2;
}
.aa-concept-label{
  font-size:15px;
  font-weight:700;
  color:#2D5A3D;
  margin-bottom:4px;
}
.aa-concept-def{
  font-size:14px;
  color:#2D2D2D;
  line-height:1.55;
}

/* ── SECUENCIA DE PASOS (flujo / proceso) ── */
.aa-flow{
  display:flex;
  flex-direction:column;
  align-items:stretch;
  margin:10px 0 18px;
}
.aa-flow-step{
  display:flex;
  align-items:flex-start;
  gap:12px;
  background:#FFFDF7;
  border:1.5px solid #C8DFD0;
  border-radius:10px;
  padding:10px 14px;
}
.aa-step-num{
  display:flex;
  align-items:center;
  justify-content:center;
  min-width:28px;
  height:28px;
  background:#4A7C59;
  color:white;
  font-size:14px;
  font-weight:700;
  border-radius:50%;
  flex-shrink:0;
}
.aa-step-text{
  font-size:14px;
  color:#2D2D2D;
  line-height:1.5;
  padding-top:4px;
}
.aa-flow-arrow{
  text-align:center;
  font-size:18px;
  color:#4A7C59;
  font-weight:700;
  padding:2px 0;
  line-height:1.2;
}

/* ── CAUSA → EFECTO ── */
.aa-cause-effect{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
  margin:10px 0 18px;
}
.aa-cause{
  flex:1;
  min-width:120px;
  background:#FEF3E8;
  border:1.5px solid #E8834A;
  border-radius:10px;
  padding:10px 14px;
  font-size:14px;
  color:#2D2D2D;
  text-align:center;
  font-weight:500;
}
.aa-effect-arrow{
  font-size:22px;
  color:#4A7C59;
  font-weight:700;
  flex-shrink:0;
}
.aa-effect{
  flex:1;
  min-width:120px;
  background:#F0F7F2;
  border:1.5px solid #4A7C59;
  border-radius:10px;
  padding:10px 14px;
  font-size:14px;
  color:#2D2D2D;
  text-align:center;
  font-weight:500;
}

/* ── GLOSARIO ── */
.aa-glossary-item{
  display:flex;
  align-items:baseline;
  gap:12px;
  padding:8px 12px;
  border-bottom:1px solid #EDE8E0;
}
.aa-gloss-term{
  font-size:14px;
  font-weight:700;
  color:#E8834A;
  min-width:100px;
  flex-shrink:0;
}
.aa-gloss-def{
  font-size:14px;
  color:#2D2D2D;
  line-height:1.5;
}

/* ── RECUADRO DE INFORMACIÓN IMPORTANTE ── */
.aa-highlight-box{
  display:flex;
  align-items:flex-start;
  gap:10px;
  background:#FFFBF0;
  border:1.5px solid #F5D078;
  border-left:4px solid #E8A020;
  border-radius:0 10px 10px 0;
  padding:12px 16px;
  margin:10px 0 18px;
}
.aa-highlight-icon{
  font-size:18px;
  flex-shrink:0;
  line-height:1.4;
}
.aa-highlight-box p{
  font-size:14px;
  color:#2D2D2D;
  line-height:1.5;
  margin:0;
}

/* ── GRUPO DE CONTEO — fichas de matemáticas ── */
.aa-count-group{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  margin:12px 0 8px;
  align-items:flex-end;
}
.aa-count-item{
  display:flex;
  flex-direction:column;
  align-items:center;
}
.aa-count-img{
  width:52px;
  height:52px;
  object-fit:contain;
}
.aa-count-emoji{
  font-size:36px;
  line-height:1;
}

/* ── CUADRÍCULA DE COLOREAR ── */
.aa-color-grid{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin:12px 0 16px;
}
.aa-color-cell{
  width:40px;
  height:40px;
  border:2.5px solid #4A7C59;
  border-radius:5px;
  background:white;
}
.aa-color-cell--example{
  background:#B8E0C4;
}

/* ── TABLA DE UNIR ── */
.aa-match-table{
  width:100%;
  border-collapse:separate;
  border-spacing:0 10px;
  margin:10px 0 18px;
}
.aa-match-number{
  font-size:28px;
  font-weight:700;
  color:#E8842A;
  width:60px;
  text-align:center;
  vertical-align:middle;
}
.aa-match-word{
  font-size:14px;
  font-weight:600;
  color:#2D2D2D;
  width:80px;
  vertical-align:middle;
  padding-left:4px;
}
.aa-match-line{
  width:48px;
  vertical-align:middle;
  text-align:center;
  color:#C4A882;
  font-size:20px;
}
.aa-match-group{
  vertical-align:middle;
  padding-left:8px;
}
.aa-match-group .aa-count-group{
  margin:0;
  gap:6px;
}
.aa-match-group .aa-count-img{
  width:36px;
  height:36px;
}

/* ── PRINT — idéntico a la web ── */
@media print{
  body{background:${bodyBg};padding:0}
  .aa-page{
    box-shadow:none;
    border-radius:0;
    max-width:100%;
  }
  .aa-header{padding:20px 36px 18px}
  .aa-body{padding:28px 36px}
  .aa-block{opacity:1!important;transform:none!important}
  .aa-activity{break-inside:avoid}
  .aa-vf-item{break-inside:avoid}
  .aa-ruled-line,
  .aa-ruled-box,
  .aa-cell-ruled,
  .aa-checkbox,
  .aa-calc-box,
  .aa-equation-block,
  .aa-solution-line .aa-solution-blank,
  .aa-concept-box,
  .aa-flow-step,
  .aa-cause,.aa-effect,
  .aa-highlight-box,
  .aa-count-img,
  .aa-color-cell,
  .aa-color-cell--example,
  .aa-match-table{
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
}
`.trim();

  const subjectOverrides = buildSubjectCssOverrides(subject);
  return subjectOverrides ? `${baseCss}\n\n${subjectOverrides}` : baseCss;
}

// ─── Overrides visuales por asignatura ───────────────────────────────────────
// Usa el atributo data-subject inyectado por normalizeDocumentHtml().
// Si subject es undefined, vacío o no reconocido → devuelve string vacío (sin efecto).
// Los overrides van al final del CSS base para que ganen en especificidad.

export function buildSubjectCssOverrides(subject?: string): string {
  switch (subject) {

    // ── Matemáticas ──────────────────────────────────────────────────────────
    // Sensación operativa y despejada: más aire entre bloques, instrucciones
    // visibles, espacios de trabajo amplios y ordenados.
    case "matematicas":
      return `
/* ── Overrides matemáticas ── */
.aa-body[data-subject="matematicas"] .aa-block{margin-bottom:20px}
.aa-body[data-subject="matematicas"] .aa-reading-block p{line-height:1.55;margin-bottom:8px}
.aa-body[data-subject="matematicas"] .aa-instruction{font-weight:700;margin-bottom:10px;font-size:15px}
.aa-body[data-subject="matematicas"] .aa-ruled-line{margin:4px 0 14px}
.aa-body[data-subject="matematicas"] .aa-ruled-box{margin:6px 0 14px}
.aa-body[data-subject="matematicas"] .aa-equation-block{margin-bottom:12px;font-size:16px}
.aa-body[data-subject="matematicas"] .aa-calc-box{min-height:88px;margin:6px 0 14px}
.aa-body[data-subject="matematicas"] .aa-solution-line{margin:2px 0 14px}
.aa-body[data-subject="matematicas"] .aa-activity{padding:20px 24px}
.aa-body[data-subject="matematicas"] .aa-count-group{gap:8px;margin:10px 0 6px}
.aa-body[data-subject="matematicas"] .aa-color-cell{width:36px;height:36px}
.aa-body[data-subject="matematicas"] .aa-match-number{font-size:24px}
`.trim();

    // ── Lengua ───────────────────────────────────────────────────────────────
    // Sensación legible y fluida: más line-height en párrafos, mejor separación
    // entre bloques de lectura, instrucciones claras pero no agresivas.
    case "lengua":
      return `
/* ── Overrides lengua ── */
.aa-body[data-subject="lengua"] .aa-reading-block p{line-height:1.95;margin-bottom:14px}
.aa-body[data-subject="lengua"] .aa-block{margin-bottom:28px}
.aa-body[data-subject="lengua"] .aa-instruction{font-weight:600;line-height:1.75;margin-bottom:14px}
.aa-body[data-subject="lengua"] .aa-sub-question{line-height:1.8;margin:16px 0 8px}
.aa-body[data-subject="lengua"] strong{font-weight:700}
.aa-body[data-subject="lengua"] .aa-ruled-box{margin:10px 0 20px}
`.trim();

    // ── Naturales ────────────────────────────────────────────────────────────
    // Balance entre lectura expositiva y actividades estructuradas.
    case "naturales":
      return `
/* ── Overrides naturales ── */
.aa-body[data-subject="naturales"] .aa-reading-block p{line-height:1.8;margin-bottom:12px}
.aa-body[data-subject="naturales"] .aa-block{margin-bottom:24px}
.aa-body[data-subject="naturales"] .aa-instruction{font-weight:600;margin-bottom:12px}
.aa-body[data-subject="naturales"] .aa-table{margin:14px 0}
`.trim();

    // ── Inglés ───────────────────────────────────────────────────────────────
    // Claridad léxica: más espacio alrededor de instrucciones bilingües.
    case "ingles":
      return `
/* ── Overrides inglés ── */
.aa-body[data-subject="ingles"] .aa-reading-block p{line-height:1.85;letter-spacing:0.01em}
.aa-body[data-subject="ingles"] .aa-instruction{font-weight:600;margin-bottom:12px;line-height:1.7}
.aa-body[data-subject="ingles"] .aa-block{margin-bottom:26px}
.aa-body[data-subject="ingles"] .aa-ruled-line{margin:4px 0 16px}
`.trim();

    // "otra" y cualquier valor no reconocido → sin override
    default:
      return "";
  }
}

// ─── Inyección del CSS en el HTML devuelto por el modelo ─────────────────────
// Elimina cualquier <style> que el modelo haya incluido (por si acaso)
// e inyecta el CSS generado server-side en su lugar.

export function injectCssIntoHtml(rawHtml: string, css: string): string {
  // 1. Limpiar cualquier <style> que el modelo haya generado
  const cleaned = rawHtml.replace(/<style[\s\S]*?<\/style>/gi, "").trim();

  // 2. Construir el bloque <style> definitivo con ID único
  const styleBlock = `<style id="aa-document-styles">\n${css}\n</style>`;

  // 3. Inyectar: si hay <head>, dentro; si no, al principio
  if (/<head[\s>]/i.test(cleaned)) {
    return cleaned.replace(/(<head[^>]*>)/i, `$1\n${styleBlock}`);
  }
  return styleBlock + "\n" + cleaned;
}
