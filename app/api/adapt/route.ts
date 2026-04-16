// app/api/adapt/route.ts — v7
// Sprint C.2: generación premium diferenciada por tier (standard vs premium)
// Cambios v7:
//   - generationTier: "standard" (free) | "premium" (pro)
//   - PREMIUM_SYSTEM_SUFFIX añadido al system prompt en tier premium
//   - Estilo docente (style_analyses) inyectado en prompt solo para pro+styleId
//   - Logging por request: plan, tier, provider, hasStyleContext
//   - JSON.parse protegido con try/catch explícito

import { createClient } from "@supabase/supabase-js";
import {
  buildAdaptationConfigFromSimpleControls,
  buildDynamicAdaptationRules,
  buildConfigFromForm,
  SUBJECT_RULES,
  buildInterestsBlock,
  getMaxActivitiesPerPage,
  getResponseBoxSize,
  getPictogramDensity,
  getWritingMetrics,
  type AdaptationConfig,
  type Subject,
  type AdaptationType,
  type SupportDegree,
} from "@/lib/adaptationRules";
import {
  extractKeywordsForPictograms,
  resolvePictograms,
  buildPictogramSuggestions,
} from "@/lib/pictogramResolver";
import { buildDocumentCss, injectCssIntoHtml } from "@/lib/buildDocumentCss";
import { getSystemPromptForProfile, FALLBACK_SYSTEM_PROMPT, PREMIUM_SYSTEM_SUFFIX } from "@/lib/ai/systemPrompts";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { hasFreeTrialRemaining, getUserPlan, FREE_TRIAL_COOKIE, type Plan } from "@/lib/subscriptionService";
import { getAIProvider } from "@/lib/ai/provider";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type AdaptationDecision = {
  detectedBarrier: string;
  appliedAdjustment: string;
  pedagogicalReason: string;
};

// ─── Utilidades ───────────────────────────────────────────────────────────────

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .trim();
}

function safeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((i): i is string => typeof i === "string");
  return [];
}

function normalizeDecisions(raw: unknown): AdaptationDecision[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      return {
        detectedBarrier: String(r.detectedBarrier || r.barrera || "Barrera detectada"),
        appliedAdjustment: String(r.appliedAdjustment || r.ajuste || "Ajuste aplicado"),
        pedagogicalReason: String(r.pedagogicalReason || r.motivo || "Mejora del acceso"),
      };
    })
    .filter((i): i is AdaptationDecision => Boolean(i))
    .slice(0, 10);
}

// ─── Contexto de estilo docente (solo Pro) ────────────────────────────────────

function buildStyleContextBlock(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (row.summary) parts.push(`Resumen del estilo: ${String(row.summary)}`);
  if (row.usual_structure) parts.push(`Estructura habitual: ${String(row.usual_structure)}`);
  if (row.instruction_style) parts.push(`Tipo de consignas: ${String(row.instruction_style)}`);
  if (row.tone) parts.push(`Tono habitual: ${String(row.tone)}`);
  if (row.key_observations) parts.push(`Observaciones clave: ${String(row.key_observations)}`);
  if (parts.length === 0) return "";

  return `═══════════════════════════════════════════════
ESTILO DOCENTE (guía de personalización Pro)
═══════════════════════════════════════════════

Este documento debe reflejar el estilo pedagógico habitual del docente:

${parts.join("\n")}

Aplica este estilo como referencia de personalización. Si hay conflicto con las reglas del perfil NEE, las reglas del perfil prevalecen siempre.`;
}

// ─── Construcción del user prompt ─────────────────────────────────────────────

function buildPrompt(params: {
  sourceText: string;
  config: AdaptationConfig;
  rulesText: string;
  subjectRulesText: string;
  interestsBlock: string;
  maxActivities: number;
  responseBoxSize: string;
  pictogramDensity: string;
  pictogramSuggestions: string;
  educationalLevel: "primaria" | "secundaria";
}): string {
  const isHighSupport = params.config.supportLevel === "alto";
  const hasTdah = params.config.learningProfile === "tdah";
  const pictogramMode = isHighSupport ? "TARJETA" : "INLINE";

  return `
DOCUMENTO ORIGINAL
${params.sourceText}

CONFIGURACIÓN
Perfil: ${params.config.learningProfile} | Nivel: ${params.config.adaptationLevel} | Apoyo: ${params.config.supportLevel}
${params.config.studentInterests?.length ? `Intereses (solo para ejemplos): ${params.config.studentInterests.join(", ")}` : ""}

REGLAS PEDAGÓGICAS OBLIGATORIAS
${params.rulesText}

${params.subjectRulesText}

${params.interestsBlock}

═══════════════════════════════════════════════
SISTEMA DE PICTOGRAMAS — MODO ${pictogramMode}
═══════════════════════════════════════════════

${isHighSupport ? `
MODO TARJETA (apoyo ALTO): imagen centrada encima + palabra debajo. NO inline.
Cada párrafo tiene sus pictogramas al lado o debajo, en una fila.

Tarjeta individual:
<div class="aa-picto-card">
  <img class="aa-picto-img" src="URL_ARASAAC" alt="palabra">
  <span class="aa-picto-word">palabra</span>
</div>

Fila de pictogramas:
<div class="aa-picto-row">
  [tarjetas aquí]
</div>

En instrucciones con apoyo ALTO: pon la fila de pictogramas ANTES del texto.
` : `
MODO INLINE (apoyo bajo/medio): pictograma directamente en la frase junto a la palabra.
<img class="aa-picto-inline" src="URL_ARASAAC" alt="palabra">
Solo en sustantivos concretos. Nunca en preguntas ni palabras abstractas.
`}

PICTOGRAMAS DISPONIBLES (usa SOLO estos):
${params.pictogramSuggestions}

NO uses pictograma si la palabra no está en la lista.
NO pongas pictogramas en preguntas (¿...?) ni en palabras abstractas.

═══════════════════════════════════════════════
ESPACIOS DE ESCRITURA
═══════════════════════════════════════════════

LÍNEA SIMPLE (completar palabras o frases):
<div class="aa-ruled-line"></div>

CAJA CON PAUTA (respuestas de varias líneas):
<div class="aa-ruled-box"></div>

CAJA GRANDE (respuesta larga o de opinión):
<div class="aa-ruled-box aa-ruled-box--large"></div>

INICIO DE RESPUESTA DADO (apoyo alto):
<div class="aa-ruled-box"><span class="aa-starter">Abril tiene... días.</span></div>

VERDADERO / FALSO:
<div class="aa-vf-item">
  <p class="aa-sub-question">a) Texto de la frase.</p>
  <div class="aa-check-row">
    <label class="aa-check-option"><span class="aa-checkbox"></span>VERDAD</label>
    <label class="aa-check-option"><span class="aa-checkbox"></span>MENTIRA</label>
  </div>
  <p class="aa-correction-label">Si es mentira, escríbela bien:</p>
  <div class="aa-ruled-box"></div>
</div>

TABLA DE COMPLETAR:
<table class="aa-table">
  <tr><td class="aa-cell-label">Enero:</td><td class="aa-cell-ruled"></td></tr>
</table>

EJEMPLO RESUELTO:
<div class="aa-example">Texto del ejemplo aquí</div>

${hasTdah ? `CASILLA DE COMPLETADO (al final de cada actividad):
<div class="aa-done-row"><span class="aa-checkbox"></span><span>He terminado ✓</span></div>` : ""}

═══════════════════════════════════════════════
ESTRUCTURA DEL DOCUMENTO — SIN <style>
═══════════════════════════════════════════════

IMPORTANTE: NO incluyas ningún bloque <style>. El CSS lo inyecta el servidor.

Estructura obligatoria:

<div class="aa-page">

  <div class="aa-header">
    <h1>Título del documento</h1>
    <div class="aa-meta">Documento adaptado · AdaptAula</div>
  </div>

  <div class="aa-body">

    <!-- PARTE 1: LECTURA -->
    <div class="aa-block aa-reading-block" data-block="lectura-1">
      <span class="aa-subtitle">Subtítulo de sección</span>
      <p>Párrafo del texto adaptado.</p>
      ${isHighSupport ? `<div class="aa-picto-row">
        <div class="aa-picto-card">
          <img class="aa-picto-img" src="URL" alt="palabra">
          <span class="aa-picto-word">palabra</span>
        </div>
      </div>` : ""}
    </div>

    <hr class="aa-separator">

    <h2 class="aa-section-title">Actividades</h2>

    <!-- PARTE 2: ACTIVIDADES -->
    <div class="aa-block aa-activity" data-block="actividad-1">
      <div class="aa-activity-number">Actividad 1</div>
      <p class="aa-instruction">Instrucción de la actividad.</p>
    </div>

  </div>
</div>

Cada div.aa-block DEBE tener su atributo data-block (necesario para animaciones).
Máximo ${params.maxActivities} actividad por bloque visual.
${isHighSupport ? "Añade filas de pictogramas después de cada párrafo de lectura." : ""}
${hasTdah ? "Incluye la casilla de completado al final de cada actividad." : ""}
INCLUYE ABSOLUTAMENTE TODAS las actividades del original. Ninguna puede faltar.

═══════════════════════════════════════════════
PROCESO
═══════════════════════════════════════════════

1. ANALIZA el original completamente.
2. ADAPTA la lectura en bloques cortos con subtítulos.
${isHighSupport ? "3. Añade filas de pictogramas después de cada párrafo de lectura." : ""}
3. ADAPTA TODAS las actividades. Ninguna puede faltar.
4. GENERA el HTML con la estructura exacta descrita (sin <style>).
5. Devuelve JSON con documentHtml, adaptation_decisions y teacherNotes.
${params.educationalLevel === "secundaria" ? `
═══════════════════════════════════════════════
NIVEL EDUCATIVO: Secundaria/ESO (11-16 años). Mantén el rigor matemático y el vocabulario propio de ESO. No simplifiques las operaciones ni el contenido curricular. Solo adapta el ACCESO (estructura, apoyos visuales, chunking) no el CONTENIDO.
═══════════════════════════════════════════════
` : ""}`.trim();
}

// ─── Handler principal ────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Parse body + headers antes de crear el stream (closure para ReadableStream)
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  // ── Rate limiting (antes del stream) ──────────────────────────────────────
  // Para conocer el userId en la comprobación de límite necesitamos validar
  // el token previamente. Creamos un cliente temporal solo para esto.
  let rateLimitUserId = "";
  if (token) {
    const rlClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data } = await rlClient.auth.getUser(token);
    rateLimitUserId = data.user?.id ?? "";
  }

  const clientIp = getClientIp(req.headers);
  const rl = checkRateLimit(clientIp, rateLimitUserId);

  const rlHeaders = {
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(rl.remaining),
    "X-RateLimit-Reset": String(rl.resetInSeconds),
  };

  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: "RATE_LIMIT", retryAfter: rl.resetInSeconds }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rl.resetInSeconds),
          ...rlHeaders,
        },
      },
    );
  }

  // ── Free trial enforcement ─────────────────────────────────────────────────
  const trialExhaustedResponse = new Response(
    JSON.stringify({
      error: "Ya has usado tu adaptación gratuita. Hazte Pro para seguir adaptando materiales.",
      code: "FREE_TRIAL_EXHAUSTED",
      currentPlan: "free",
      limit: 1,
    }),
    { status: 402, headers: { "Content-Type": "application/json", ...rlHeaders } },
  );

  let userPlan: Plan = "free";

  if (rateLimitUserId) {
    // Authenticated user: check plan and DB usage
    userPlan = await getUserPlan(rateLimitUserId);
    if (userPlan !== "pro") {
      const remaining = await hasFreeTrialRemaining(rateLimitUserId);
      if (!remaining) return trialExhaustedResponse;
    }
  } else {
    // Anonymous user: check cookie set by the client after their first successful adaptation.
    // Limitation: cookie is client-side and can be cleared. This is a best-effort soft limit.
    const cookieHeader = req.headers.get("cookie") ?? "";
    const hasTrialCookie = cookieHeader.split(";").some(
      (c) => c.trim().startsWith(`${FREE_TRIAL_COOKIE}=`),
    );
    if (hasTrialCookie) return trialExhaustedResponse;
  }

  const aiProvider = getAIProvider(userPlan);
  const generationTier: "standard" | "premium" = userPlan === "pro" ? "premium" : "standard";

  const {
    content,
    workType,
    adaptationType,
    studentProfile,
    withPictograms,
    styleId,
  } = body;

  const subject = (body.subject as Subject) ?? "otra";
  const adaptationTypeNew = (body.adaptationType as AdaptationType) ?? "simplificar";
  const supportDegree = (body.supportDegree as SupportDegree) ?? "medio";
  const studentInterests = Array.isArray(body.studentInterests)
    ? body.studentInterests.filter((i): i is string => typeof i === "string")
    : [];
  const educationalLevel = body.educationalLevel === "secundaria" ? "secundaria" : "primaria";
  const sourceText = typeof content === "string" ? content : "";

  // ── Estilo docente (solo Pro + styleId) ───────────────────────────────────
  // Fetch previo al stream para que esté disponible en buildPrompt.
  // El error es silencioso: el contexto de estilo es mejora, no requisito.
  let styleContextBlock = "";
  if (generationTier === "premium" && typeof styleId === "string" && styleId) {
    try {
      const styleClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : undefined,
      );
      const { data } = await styleClient
        .from("style_analyses")
        .select("summary, usual_structure, instruction_style, tone, key_observations")
        .eq("style_id", styleId)
        .maybeSingle();
      if (data) styleContextBlock = buildStyleContextBlock(data as Record<string, unknown>);
    } catch { /* estilo es enhancement, no falla el request */ }
  }

  const encoder = new TextEncoder();

  function sseChunk(data: Record<string, unknown>): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Estimación de chars para progreso: la mayoría de respuestas son 3000-8000 chars.
  // Con 5000 como referencia: al llegar a 5000 chars mostramos 95%.
  const ESTIMATED_CHARS = 5000;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );

        // ── Config pedagógica ────────────────────────────────────────────
        const isNewFormFormat =
          typeof body.subject === "string" && typeof body.supportDegree === "string";

        const config: AdaptationConfig = isNewFormFormat
          ? buildConfigFromForm({
              subject,
              adaptationType: adaptationTypeNew,
              supportDegree,
              studentInterests,
            })
          : buildAdaptationConfigFromSimpleControls({
              need: typeof studentProfile === "string" ? studentProfile : "",
              adaptationType: typeof adaptationType === "string" ? adaptationType : "",
              level: typeof body.visualSupportLevel === "string" ? body.visualSupportLevel : "medio",
              selectedStyleId: typeof styleId === "string" ? styleId : null,
              studentInterests,
            });

        const rulesText = buildDynamicAdaptationRules(config);
        const subjectRulesText = SUBJECT_RULES[subject];
        const interestsBlock = buildInterestsBlock(studentInterests);
        const maxActivities = getMaxActivitiesPerPage(config.supportLevel);
        const responseBoxSize = getResponseBoxSize(config);
        const pictogramDensity = getPictogramDensity(config);
        const writingMetrics = getWritingMetrics(config);

        // ── auth + pictogramas en paralelo ────────────────────────────────
        const keywords = extractKeywordsForPictograms(sourceText, {
          supportLevel: config.supportLevel,
          subject,
        });

        const [authResult, resolvedPictograms] = await Promise.all([
          token
            ? supabase.auth.getUser(token)
            : Promise.resolve({ data: { user: null }, error: null }),
          resolvePictograms(keywords),
        ]);

        const userId = authResult.data.user?.id || "";
        const pictogramSuggestions = buildPictogramSuggestions(resolvedPictograms);

        // ── Prompts ───────────────────────────────────────────────────────
        const basePrompt = buildPrompt({
          sourceText,
          config,
          rulesText,
          subjectRulesText,
          interestsBlock,
          maxActivities,
          responseBoxSize,
          pictogramDensity,
          pictogramSuggestions,
          educationalLevel,
        });

        const userPrompt = styleContextBlock
          ? `${basePrompt}\n\n${styleContextBlock}`
          : basePrompt;

        const baseSystemPrompt = config.learningProfile
          ? getSystemPromptForProfile(config.learningProfile)
          : FALLBACK_SYSTEM_PROMPT;

        const systemPrompt = generationTier === "premium"
          ? `${baseSystemPrompt}\n\n${PREMIUM_SYSTEM_SUFFIX}`
          : baseSystemPrompt;

        // ── Logging ───────────────────────────────────────────────────────
        const providerName = userPlan === "pro" && process.env.OPENAI_API_KEY ? "openai" : "gemini";
        console.log("[ADAPT]", {
          plan: userPlan,
          tier: generationTier,
          provider: providerName,
          hasStyleContext: Boolean(styleContextBlock),
          profile: config.learningProfile,
        });

        // ── Llamada al proveedor IA ───────────────────────────────────────
        let lastSentProgress = 0;

        const rawText = await aiProvider.stream(systemPrompt, userPrompt, (accumulated) => {
          const pct = Math.min(95, Math.round((accumulated / ESTIMATED_CHARS) * 100));
          if (pct > lastSentProgress) {
            lastSentProgress = pct;
            controller.enqueue(sseChunk({ type: "delta", progress: pct }));
          }
        });

        let raw: Record<string, unknown>;
        try {
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          raw = JSON.parse(jsonMatch ? jsonMatch[0] : rawText) as Record<string, unknown>;
        } catch (parseErr) {
          console.error("[ADAPT] JSON_PARSE_ERROR", { provider: providerName, rawLength: rawText.length, parseErr });
          throw new Error("El modelo devolvió una respuesta con formato inválido. Inténtalo de nuevo.");
        }

        // ── Procesar resultado ────────────────────────────────────────────
        const rawHtml =
          typeof raw.documentHtml === "string"
            ? raw.documentHtml
            : typeof raw.document === "string"
              ? raw.document
              : "";

        if (!rawHtml.trim()) {
          throw new Error("El modelo no devolvió documentHtml");
        }

        const css = buildDocumentCss(config, writingMetrics);
        const documentHtml = injectCssIntoHtml(sanitizeHtml(rawHtml), css);
        const adaptationDecisions = normalizeDecisions(
          raw.adaptation_decisions || raw.adaptationDecisions,
        );
        const teacherNotes = safeStringArray(raw.teacherNotes || raw.teacherObservations);

        // ── Guardar en Supabase si hay usuario ───────────────────────────
        if (userId) {
          await supabase.from("adaptations").insert({
            user_id: userId,
            source_text: sourceText,
            result_html: documentHtml,
            work_type: typeof workType === "string" ? workType : null,
            adaptation_type: typeof adaptationType === "string" ? adaptationType : null,
            student_profile: typeof studentProfile === "string" ? studentProfile : null,
            with_pictograms: Boolean(withPictograms),
            style_id: typeof styleId === "string" ? styleId : null,
            ai_notes: teacherNotes.join("\n"),
          });
        }

        // ── Evento final ──────────────────────────────────────────────────
        controller.enqueue(
          sseChunk({
            type: "done",
            documentHtml,
            teacherNotes,
            adaptationDecisions,
            pictogramConcepts: keywords,
          }),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Error desconocido";
        console.error("ADAPT_ERROR:", error);
        controller.enqueue(sseChunk({ type: "error", message }));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      "Connection": "keep-alive",
      ...rlHeaders,
    },
  });
}
