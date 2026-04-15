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

  return `
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
  .aa-solution-line .aa-solution-blank{
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
}
`.trim();
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
