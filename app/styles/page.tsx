"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AuthNavButton from "@/components/AuthNavButton";
import BrandLogo from "@/components/BrandLogo";
import { extractTextFromDocument } from "@/lib/extractDocumentText";
import {
  createStyleFromDocument,
  deleteStyle,
  duplicateStyle,
  getStyleAnalysesByUser,
  getSessionUser,
  getStyleHistory,
  getUserStyles,
  setActiveStyle,
  type StyleEntity,
  type StyleAnalysisEntity,
  type StyleHistoryEntity,
  updateStyle,
} from "@/lib/stylesService";
import { supabase } from "@/lib/supabaseClient";

type ToastType = "success" | "error";

type ToastState = {
  id: number;
  message: string;
  type: ToastType;
} | null;

type FormState = {
  title: string;
  description: string;
  analysisInstructions: string;
  showImprovements: boolean;
  file: File | null;
};

type StyleAnalysisApiResult = {
  simplificationLevel: string;
  pictogramUsageLevel: string;
  usualStructure: string;
  instructionStyle: string;
  averageLength: string;
  tone: string;
  keyObservations: string;
  analysisJson: Record<string, unknown>;
  sourceExcerpt: string;
  strengths: string;
  improvementPoints: string;
  visualMetrics: Record<string, unknown>;
  summary: string;
};

const MAX_STYLE_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_STYLE_FILE_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

function formatDate(date: string) {
  if (!date) return "Fecha no disponible";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function deriveAnalysis(style: StyleEntity, analysis?: StyleAnalysisEntity) {
  if (analysis) {
    return {
      simplification:
        Number(analysis.visualMetrics?.simplificationScore ?? 0) ||
        (/(\d{1,3})/.exec(analysis.simplificationLevel)?.[1]
          ? Number(/(\d{1,3})/.exec(analysis.simplificationLevel)?.[1])
          : 70),
      pictograms: analysis.pictogramUsageLevel || "No determinado",
      structure: analysis.usualStructure || "No determinada",
      length: analysis.averageLength || "No determinada",
      tone: analysis.tone || "No determinado",
      instructionStyle: analysis.instructionStyle || "No determinado",
      observations: analysis.keyObservations || "",
      strengths: analysis.strengths || "",
      improvements:
        analysis.showImprovements && analysis.improvementPoints
          ? analysis.improvementPoints
          : "",
      summary: analysis.summary || "",
      sourceExcerpt: analysis.sourceExcerpt || "",
      hasVisualMetrics: Boolean(analysis.visualMetrics),
      quote:
        analysis.summary ||
        analysis.keyObservations ||
        "Análisis disponible para este estilo.",
    };
  }

  const base = style.analysisText || style.content || "";
  const words = base.split(/\s+/).filter(Boolean).length;
  const simplification = Math.min(95, Math.max(45, 55 + Math.floor(words / 25)));

  return {
    simplification,
    pictograms: /pictograma|visual|icon|arasaac/i.test(base) ? "Medio" : "Bajo",
    structure: /paso|lista|sección|modular/i.test(base) ? "Modular" : "Secuencial",
    length: words > 350 ? "Extensa" : words > 180 ? "Mid-range" : "Compacta",
    tone: "No determinado",
    instructionStyle: "No determinado",
    observations: "",
    strengths: "",
    improvements: "",
    summary: "",
    sourceExcerpt: "",
    hasVisualMetrics: false,
    quote:
      style.analysisText ||
      "Este estilo todavía no tiene análisis IA guardado. Puedes usar “Ver análisis” y, cuando se conecte la generación IA completa, se guardará automáticamente en Supabase.",
  };
}

export default function StylesPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [styles, setStyles] = useState<StyleEntity[]>([]);
  const [analysesByStyleId, setAnalysesByStyleId] = useState<
    Record<string, StyleAnalysisEntity>
  >({});
  const [history, setHistory] = useState<StyleHistoryEntity[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [historyScope, setHistoryScope] = useState<string>("general");

  const [loadingStyles, setLoadingStyles] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [toast, setToast] = useState<ToastState>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStyle, setEditingStyle] = useState<StyleEntity | null>(null);
  const [form, setForm] = useState<FormState>({
    title: "",
    description: "",
    analysisInstructions: "",
    showImprovements: true,
    file: null,
  });
  const [formError, setFormError] = useState<string>("");

  const [isSaving, setIsSaving] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const selectedStyle = useMemo(
    () => styles.find((style) => style.id === selectedStyleId) || null,
    [selectedStyleId, styles],
  );

  function pushToast(message: string, type: ToastType) {
    const id = Date.now();
    setToast({ id, message, type });
    window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 3000);
  }

  function openCreateModal() {
    setEditingStyle(null);
    setFormError("");
    setForm({
      title: "",
      description: "",
      analysisInstructions: "",
      showImprovements: true,
      file: null,
    });
    setIsModalOpen(true);
  }

  function openEditModal(style: StyleEntity) {
    setEditingStyle(style);
    setFormError("");
    setForm({
      title: style.title,
      description: style.description,
      analysisInstructions: "",
      showImprovements: true,
      file: null,
    });
    setIsModalOpen(true);
  }

  function closeModal() {
    if (isSaving || isAnalyzing) return;
    setIsModalOpen(false);
    setEditingStyle(null);
    setFormError("");
    setForm({
      title: "",
      description: "",
      analysisInstructions: "",
      showImprovements: true,
      file: null,
    });
  }

  const loadStyles = useCallback(async (sessionUserId: string) => {
    setLoadingStyles(true);
    try {
      const [result, analyses] = await Promise.all([
        getUserStyles(sessionUserId),
        getStyleAnalysesByUser(sessionUserId),
      ]);
      setStyles(result);
      setAnalysesByStyleId(analyses);
      const active = result.find((item) => item.isActive);
      setSelectedStyleId((current) => current || active?.id || result[0]?.id || null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron cargar los estilos.";
      pushToast(message, "error");
      setStyles([]);
      setAnalysesByStyleId({});
    } finally {
      setLoadingStyles(false);
    }
  }, []);

  const loadHistory = useCallback(async (sessionUserId: string, styleId?: string) => {
    setLoadingHistory(true);
    try {
      const result = await getStyleHistory(sessionUserId, styleId);
      setHistory(result);
      setHistoryScope(styleId ? "estilo" : "general");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cargar el historial.";
      pushToast(message, "error");
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const user = await getSessionUser();

        if (!mounted) return;

        if (!user) {
          router.replace("/login?next=/styles");
          setLoadingStyles(false);
          setLoadingHistory(false);
          return;
        }

        setUserId(user.id);
        await Promise.all([loadStyles(user.id), loadHistory(user.id)]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo iniciar la pantalla.";
        pushToast(message, "error");
        setLoadingStyles(false);
        setLoadingHistory(false);
      }
    }

    bootstrap();

    return () => {
      mounted = false;
    };
  }, [loadHistory, loadStyles, router]);

  async function handleSaveStyle() {
    if (!userId || isSaving || isAnalyzing) return;

    if (!form.title.trim()) {
      setFormError("El nombre del estilo es obligatorio.");
      return;
    }

    setFormError("");
    setIsSaving(true);

    try {
      if (editingStyle) {
        const payload = {
          title: form.title.trim(),
          description: form.description.trim(),
          content: editingStyle.content || "",
        };
        const updated = await updateStyle(editingStyle.id, userId, payload);
        setStyles((current) =>
          current
            .map((style) => (style.id === updated.id ? updated : style))
            .sort((a, b) => (new Date(b.updatedAt).getTime() || 0) - (new Date(a.updatedAt).getTime() || 0)),
        );
        setSelectedStyleId(updated.id);
        pushToast("Estilo actualizado correctamente.", "success");
      } else {
        if (!form.file) {
          setFormError("Sube un documento PDF o DOCX para crear el estilo.");
          return;
        }

        const lowerFileName = form.file.name.toLowerCase();
        const isAllowedByName =
          lowerFileName.endsWith(".pdf") ||
          lowerFileName.endsWith(".docx") ||
          lowerFileName.endsWith(".doc");
        const isAllowedByMime = ALLOWED_STYLE_FILE_TYPES.includes(form.file.type);

        if (!isAllowedByMime && !isAllowedByName) {
          setFormError("Formato no permitido. Usa PDF o DOCX.");
          return;
        }

        if (form.file.size > MAX_STYLE_FILE_SIZE) {
          setFormError("El archivo supera el tamaño máximo permitido (10MB).");
          return;
        }

        setIsAnalyzing(true);
        const extractedText = await extractTextFromDocument(form.file);
        if (!extractedText.trim()) {
          setFormError("No se pudo extraer texto del documento subido.");
          return;
        }

        const created = await createStyleFromDocument(userId, {
          name: form.title.trim(),
          description: form.description.trim(),
          sourceFileName: form.file.name,
          sourceFileUrl: null,
          sourceDocumentId: null,
          structure: null,
        });

        let analysisError = "";
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (!session?.access_token) {
            throw new Error("Sesión inválida para analizar estilos.");
          }

          const analysisResponse = await fetch("/api/style-analysis", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              styleId: created.id,
              documentText: extractedText,
              styleName: form.title.trim(),
              description: form.description.trim(),
              analysisInstructions: form.analysisInstructions.trim(),
              showImprovements: form.showImprovements,
            }),
          });

          const analysisPayload =
            (await analysisResponse.json().catch(() => ({}))) as
              | Partial<StyleAnalysisApiResult>
              | { error?: string };

          if (!analysisResponse.ok) {
            analysisError =
              (analysisPayload as { error?: string }).error ||
              "No se pudo analizar el estilo con IA.";
          } else {
            const savedRaw =
              (analysisPayload as { savedAnalysis?: Record<string, unknown> })
                .savedAnalysis || null;
            if (savedRaw && typeof savedRaw === "object") {
              const styleIdRaw =
                typeof savedRaw.style_id === "string" ? savedRaw.style_id : "";
              if (styleIdRaw) {
                const savedAnalysis: StyleAnalysisEntity = {
                  id: typeof savedRaw.id === "string" ? savedRaw.id : "",
                  styleId: styleIdRaw,
                  userId:
                    typeof savedRaw.user_id === "string" ? savedRaw.user_id : userId,
                  simplificationLevel:
                    typeof savedRaw.simplification_level === "string"
                      ? savedRaw.simplification_level
                      : "No determinado",
                  pictogramUsageLevel:
                    typeof savedRaw.pictogram_usage_level === "string"
                      ? savedRaw.pictogram_usage_level
                      : "No determinado",
                  usualStructure:
                    typeof savedRaw.usual_structure === "string"
                      ? savedRaw.usual_structure
                      : "No determinada",
                  instructionStyle:
                    typeof savedRaw.instruction_style === "string"
                      ? savedRaw.instruction_style
                      : "No determinado",
                  averageLength:
                    typeof savedRaw.average_length === "string"
                      ? savedRaw.average_length
                      : "No determinada",
                  tone:
                    typeof savedRaw.tone === "string"
                      ? savedRaw.tone
                      : "No determinado",
                  keyObservations:
                    typeof savedRaw.key_observations === "string"
                      ? savedRaw.key_observations
                      : "",
                  analysisJson:
                    savedRaw.analysis_json &&
                    typeof savedRaw.analysis_json === "object"
                      ? (savedRaw.analysis_json as Record<string, unknown>)
                      : null,
                  sourceExcerpt:
                    typeof savedRaw.source_excerpt === "string"
                      ? savedRaw.source_excerpt
                      : "",
                  strengths:
                    typeof savedRaw.strengths === "string"
                      ? savedRaw.strengths
                      : "",
                  improvementPoints:
                    typeof savedRaw.improvement_points === "string"
                      ? savedRaw.improvement_points
                      : "",
                  visualMetrics:
                    savedRaw.visual_metrics &&
                    typeof savedRaw.visual_metrics === "object"
                      ? (savedRaw.visual_metrics as Record<string, unknown>)
                      : null,
                  summary:
                    typeof savedRaw.summary === "string" ? savedRaw.summary : "",
                  showImprovements: Boolean(savedRaw.show_improvements),
                  createdAt:
                    typeof savedRaw.created_at === "string"
                      ? savedRaw.created_at
                      : "",
                  updatedAt:
                    typeof savedRaw.updated_at === "string"
                      ? savedRaw.updated_at
                      : typeof savedRaw.created_at === "string"
                        ? savedRaw.created_at
                        : "",
                };

                setAnalysesByStyleId((current) => ({
                  ...current,
                  [savedAnalysis.styleId]: savedAnalysis,
                }));
              }
            }
          }
        } catch (analysisFailure) {
          analysisError =
            analysisFailure instanceof Error
              ? analysisFailure.message
              : "Error inesperado al analizar el documento.";
        }

        setStyles((current) => [created, ...current]);
        setSelectedStyleId(created.id);
        if (analysisError) {
          pushToast(
            `Estilo creado, pero el análisis no se completó: ${analysisError}`,
            "error",
          );
        } else {
          pushToast("Estilo creado y analizado correctamente.", "success");
        }
      }

      closeModal();
      await loadHistory(userId, selectedStyleId || undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar el estilo.";
      setFormError(message);
      pushToast(message, "error");
    } finally {
      setIsAnalyzing(false);
      setIsSaving(false);
    }
  }

  async function handleDeleteStyle(style: StyleEntity) {
    if (!userId || deletingId || !window.confirm(`¿Eliminar el estilo “${style.title}”?`)) {
      return;
    }

    setDeletingId(style.id);

    try {
      await deleteStyle(style.id, userId);
      setStyles((current) => {
        const remaining = current.filter((item) => item.id !== style.id);
        setSelectedStyleId((currentSelected) => {
          if (currentSelected !== style.id) return currentSelected;
          return remaining[0]?.id || null;
        });
        return remaining;
      });
      pushToast("Estilo eliminado.", "success");
      await loadHistory(userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo eliminar el estilo.";
      pushToast(message, "error");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDuplicateStyle(style: StyleEntity) {
    if (!userId || duplicatingId) return;
    setDuplicatingId(style.id);

    try {
      const duplicated = await duplicateStyle(style, userId);
      setStyles((current) => [duplicated, ...current]);
      setSelectedStyleId(duplicated.id);
      pushToast("Estilo duplicado correctamente.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo duplicar el estilo.";
      pushToast(message, "error");
    } finally {
      setDuplicatingId(null);
    }
  }

  async function handleApplyStyle(style: StyleEntity) {
    if (!userId || applyingId) return;
    setApplyingId(style.id);

    try {
      await setActiveStyle(style.id, userId);
      setStyles((current) =>
        current.map((item) => ({
          ...item,
          isActive: item.id === style.id,
        })),
      );
      setSelectedStyleId(style.id);
      pushToast("Estilo activo actualizado.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo aplicar el estilo.";
      pushToast(message, "error");
    } finally {
      setApplyingId(null);
    }
  }

  async function handleViewHistory(styleId?: string) {
    if (!userId || loadingHistory) return;
    await loadHistory(userId, styleId);
  }

  function handleViewAnalysis(style: StyleEntity) {
    setSelectedStyleId(style.id);
    if (!analysesByStyleId[style.id]) {
      pushToast(
        "Este estilo todavía no tiene análisis guardado.",
        "success",
      );
    }
  }

  const selectedAnalysis = selectedStyleId
    ? analysesByStyleId[selectedStyleId]
    : undefined;
  const analysis = selectedStyle
    ? deriveAnalysis(selectedStyle, selectedAnalysis)
    : null;

  return (
    <div className="min-h-screen bg-[#f7f9ff] text-[#1a1c1c] selection:bg-[#86f8c8]/40">
      <nav className="w-full bg-[#f7f9ff]">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-8 py-4">
          <Link
            href="/"
            className="font-sans text-2xl font-black tracking-tighter text-[#0B4FB3]"
          >
            <BrandLogo compact />
          </Link>
          <div className="hidden items-center space-x-8 font-sans text-sm font-semibold tracking-tight md:flex">
            <Link
              href="/styles"
              className="border-b-2 border-[#006c4d] pb-1 font-bold text-[#0B4FB3]"
            >
              Mis estilos
            </Link>
            <Link
              href="/history"
              className="font-medium text-slate-600 transition-colors duration-200 hover:text-[#0B4FB3]"
            >
              Historial
            </Link>
          </div>
          <AuthNavButton
            loginClassName="rounded-full bg-[#0B4FB3] px-6 py-2 font-bold text-white transition-colors duration-150 hover:bg-[#3eb489] active:scale-95"
            logoutClassName="rounded-full bg-[#0B4FB3] px-6 py-2 font-bold text-white transition-colors duration-150 hover:bg-[#3eb489] active:scale-95"
          />
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-8 py-12">
        <header className="mb-12 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="mb-3 font-sans text-5xl font-extrabold tracking-tight text-[#1a1c1c]">
              Mis estilos
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-[#3d4943]">
              Guarda tus modelos de adaptación y deja que la IA aprenda tu forma
              de trabajar para ofrecerte resultados personalizados.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="rounded-full bg-[#9d4300] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#9d4300]/20 transition-all hover:scale-[1.02] active:scale-95"
          >
            Crear estilo
          </button>
        </header>

        <section className="mb-16 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <button
            type="button"
            onClick={openCreateModal}
            className="group relative max-w-2xl cursor-pointer overflow-hidden rounded-xl border border-[#bccac1]/30 bg-[#3eb489]/10 p-8 text-left transition-all hover:bg-[#3eb489]/20"
          >
            <div className="flex items-center gap-6">
              <div className="rounded-full bg-[#3eb489] p-4 text-[#00402d]">
                <span className="text-3xl">↥</span>
              </div>
              <div>
                <h3 className="font-sans text-xl font-bold text-[#00402d]">
                  Subir una adaptación modelo
                </h3>
                <p className="mt-1 text-sm text-[#306d58]">
                  Sube un PDF o Word para guardar su estilo de adaptación.
                </p>
              </div>
              <span className="ml-auto text-[#3eb489]">→</span>
            </div>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="group relative max-w-2xl cursor-pointer overflow-hidden rounded-xl border border-[#bccac1]/30 bg-white p-8 text-left transition-all hover:bg-[#f3f3f3]"
          >
            <div className="flex items-center gap-6">
              <div className="rounded-full bg-[#adedd3] p-4 text-[#306d58]">
                <span className="text-3xl">＋</span>
              </div>
              <div>
                <h3 className="font-sans text-xl font-bold text-[#1a1c1c]">
                  Subir otra adaptación
                </h3>
                <p className="mt-1 text-sm text-[#3d4943]">
                  Crea un nuevo estilo analizando otro documento adaptado.
                </p>
              </div>
              <span className="ml-auto text-[#6d7a72]">→</span>
            </div>
          </button>
        </section>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
          <section className="space-y-8 lg:col-span-7">
            <div className="flex items-end justify-between">
              <h2 className="font-sans text-2xl font-bold">
                Estilos guardados
              </h2>
              <span className="text-xs uppercase tracking-widest text-[#6d7a72]">
                {styles.length} Estilos activos
              </span>
            </div>

            {loadingStyles ? (
              <div className="space-y-4">
                {[1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-44 animate-pulse rounded-xl border border-[#bccac1]/20 bg-white"
                  />
                ))}
              </div>
            ) : styles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#bccac1]/50 bg-white p-10 text-center">
                <h3 className="font-sans text-xl font-bold">Aún no tienes estilos</h3>
                <p className="mt-2 text-sm text-[#3d4943]">
                  Crea tu primer estilo para reutilizar tu forma de adaptar materiales.
                </p>
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="mt-5 rounded-full bg-[#0B4FB3] px-6 py-2 text-sm font-bold text-white"
                >
                  Crear primer estilo
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {styles.map((style) => (
                  <article
                    key={style.id}
                    className={`rounded-lg border bg-white p-6 shadow-sm transition-shadow hover:shadow-md ${
                      selectedStyleId === style.id
                        ? "border-[#3eb489]/50 ring-2 ring-[#86f8c8]/40"
                        : "border-[#bccac1]/20"
                    }`}
                  >
                    <div className="mb-4 flex items-start justify-between">
                      <div>
                        <h4 className="font-sans text-xl font-bold text-[#1a1c1c]">
                          {style.title}
                        </h4>
                        <p className="mt-1 text-sm text-[#3d4943]">
                          {style.description || "Sin descripción"}
                        </p>
                      </div>
                      {style.isActive ? (
                        <span className="rounded-full bg-[#86f8c8]/30 px-3 py-1 text-[10px] font-bold uppercase tracking-tight text-[#005139]">
                          Activo
                        </span>
                      ) : null}
                    </div>

                    <div className="mb-4 flex flex-wrap gap-2">
                      <span className="rounded-full bg-[#eeeeee] px-3 py-1 text-xs font-medium text-[#3d4943]">
                        Actualizado: {formatDate(style.updatedAt)}
                      </span>
                      {!!style.sourceFileName && (
                        <span className="rounded-full bg-[#eeeeee] px-3 py-1 text-xs font-medium text-[#3d4943]">
                          Archivo: {style.sourceFileName}
                        </span>
                      )}
                      {!!style.content.trim() && !style.sourceFileName && (
                        <span className="rounded-full bg-[#eeeeee] px-3 py-1 text-xs font-medium text-[#3d4943]">
                          Configurado
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <button
                        type="button"
                        onClick={() => handleApplyStyle(style)}
                        disabled={applyingId !== null}
                        className="rounded-full bg-[#0B4FB3] px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {applyingId === style.id ? "Aplicando..." : "Aplicar estilo"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(style)}
                        disabled={isSaving || deletingId !== null}
                        className="rounded-full border border-[#bccac1]/40 px-3 py-2 text-sm font-semibold text-[#3d4943] transition-colors hover:bg-[#eeeeee] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleViewAnalysis(style)}
                        className="rounded-full border border-[#bccac1]/40 px-3 py-2 text-sm font-semibold text-[#3d4943] transition-colors hover:bg-[#eeeeee]"
                      >
                        Ver análisis
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicateStyle(style)}
                        disabled={duplicatingId !== null}
                        className="rounded-full border border-[#bccac1]/40 px-3 py-2 text-sm font-semibold text-[#3d4943] transition-colors hover:bg-[#eeeeee] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {duplicatingId === style.id ? "Duplicando..." : "Duplicar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleViewHistory(style.id)}
                        disabled={loadingHistory}
                        className="rounded-full border border-[#bccac1]/40 px-3 py-2 text-sm font-semibold text-[#3d4943] transition-colors hover:bg-[#eeeeee] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Ver historial
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedStyleId(style.id)}
                        className="rounded-full border border-[#bccac1]/40 px-3 py-2 text-sm font-semibold text-[#3d4943] transition-colors hover:bg-[#eeeeee]"
                      >
                        Seleccionar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteStyle(style)}
                        disabled={deletingId !== null}
                        className="rounded-full border border-[#ffdad6] bg-[#ffdad6]/30 px-3 py-2 text-sm font-semibold text-[#93000a] transition-colors hover:bg-[#ffdad6] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingId === style.id ? "Eliminando..." : "Eliminar"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-8 lg:col-span-5">
            <div className="flex items-center justify-between">
              <h2 className="font-sans text-2xl font-bold">
                Análisis IA del estilo
              </h2>
              <button
                type="button"
                onClick={() => handleViewHistory()}
                disabled={loadingHistory}
                className="rounded-full border border-[#bccac1]/40 px-4 py-2 text-xs font-bold text-[#3d4943] disabled:opacity-60"
              >
                Ver historial general
              </button>
            </div>

            <div className="rounded-xl border border-[#006c4d]/10 bg-white/80 p-8 shadow-2xl shadow-[#006c4d]/5 backdrop-blur-2xl">
              {!analysis ? (
                <div className="rounded-xl border border-dashed border-[#bccac1]/40 bg-white p-8 text-center text-sm text-[#3d4943]">
                  Selecciona un estilo para ver su análisis.
                </div>
              ) : (
                <>
                  <div className="mb-8 flex items-center gap-3">
                    <span className="text-[#3eb489]">✦</span>
                    <span className="text-xs font-bold uppercase tracking-widest text-[#0B4FB3]">
                      Patrones detectados
                    </span>
                  </div>

                  <div className="mb-10 space-y-6">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#3d4943]">
                        Nivel de simplificación
                      </span>
                      <div className="flex items-center gap-4">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-[#eeeeee]">
                          <div
                            className="h-full bg-[#3eb489]"
                            style={{ width: `${analysis.simplification}%` }}
                          />
                        </div>
                        <span className="text-sm font-bold">
                          {analysis.simplification}%
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#3d4943]">
                        Uso de pictogramas
                      </span>
                      <span className="rounded-full bg-[#adedd3] px-3 py-1 text-xs font-bold text-[#306d58]">
                        {analysis.pictograms}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#3d4943]">
                        Estructura habitual
                      </span>
                      <span className="text-sm font-bold">{analysis.structure}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#3d4943]">
                        Longitud media
                      </span>
                      <span className="text-sm font-bold">{analysis.length}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#3d4943]">
                        Estilo de instrucciones
                      </span>
                      <span className="text-sm font-bold">
                        {analysis.instructionStyle}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#3d4943]">
                        Tono pedagógico
                      </span>
                      <span className="text-sm font-bold">{analysis.tone}</span>
                    </div>
                  </div>

                  <blockquote className="relative rounded-lg border-l-4 border-[#006c4d] bg-[#86f8c8]/20 p-6">
                    <span className="absolute -left-3 -top-3 rounded-full bg-[#0B4FB3] p-1 text-white">
                      ❝
                    </span>
                    <p className="text-sm italic leading-relaxed text-[#005139]">
                      {analysis.quote}
                    </p>
                  </blockquote>

                  {analysis.summary ? (
                    <div className="mt-6 rounded-lg border border-[#bccac1]/30 bg-[#f7f9ff] p-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-[#6d7a72]">
                        Resumen
                      </p>
                      <p className="mt-2 text-sm text-[#3d4943]">{analysis.summary}</p>
                    </div>
                  ) : null}

                  {analysis.strengths ? (
                    <div className="mt-4 rounded-lg border border-[#bccac1]/30 bg-[#f7f9ff] p-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-[#6d7a72]">
                        Fortalezas
                      </p>
                      <p className="mt-2 text-sm text-[#3d4943]">
                        {analysis.strengths}
                      </p>
                    </div>
                  ) : null}

                  {analysis.improvements ? (
                    <div className="mt-4 rounded-lg border border-[#ffdad6] bg-[#fff3f1] p-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-[#93000a]">
                        Puntos de mejora
                      </p>
                      <p className="mt-2 text-sm text-[#93000a]">
                        {analysis.improvements}
                      </p>
                    </div>
                  ) : null}

                  {analysis.observations ? (
                    <div className="mt-4 rounded-lg border border-[#bccac1]/30 bg-white p-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-[#6d7a72]">
                        Observaciones clave
                      </p>
                      <p className="mt-2 text-sm text-[#3d4943]">
                        {analysis.observations}
                      </p>
                    </div>
                  ) : null}

                  {analysis.sourceExcerpt ? (
                    <div className="mt-4 rounded-lg border border-dashed border-[#bccac1]/50 bg-white p-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-[#6d7a72]">
                        Extracto analizado
                      </p>
                      <p className="mt-2 text-sm text-[#3d4943]">
                        {analysis.sourceExcerpt}
                      </p>
                    </div>
                  ) : null}

                  {analysis.hasVisualMetrics ? (
                    <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-[#6d7a72]">
                      Métricas visuales listas para gráficos en próximas versiones.
                    </p>
                  ) : null}
                </>
              )}
            </div>

            <div className="rounded-xl border border-[#bccac1]/20 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-sans text-lg font-bold">Historial</h3>
                <span className="text-xs uppercase tracking-widest text-[#6d7a72]">
                  {historyScope === "general" ? "General" : "Del estilo"}
                </span>
              </div>

              {loadingHistory ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((item) => (
                    <div
                      key={item}
                      className="h-16 animate-pulse rounded-lg bg-[#f3f3f3]"
                    />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#bccac1]/40 p-5 text-sm text-[#3d4943]">
                  No hay historial disponible todavía.
                </div>
              ) : (
                <div className="space-y-3">
                  {history.slice(0, 6).map((item) => (
                    <article
                      key={item.id}
                      className="rounded-lg border border-[#bccac1]/20 bg-[#f7f9ff] p-4"
                    >
                      <p className="font-semibold text-[#1a1c1c]">{item.title}</p>
                      {item.detail ? (
                        <p className="mt-1 text-sm text-[#3d4943]">{item.detail}</p>
                      ) : null}
                      <p className="mt-2 text-xs text-[#6d7a72]">{formatDate(item.createdAt)}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[#bccac1]/30 bg-white p-8 shadow-2xl">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h2 className="font-sans text-2xl font-extrabold text-[#1a1c1c]">
                  {editingStyle
                    ? "Editar metadatos del estilo"
                    : "Crear estilo desde documento"}
                </h2>
                <p className="mt-1 text-sm text-[#3d4943]">
                  {editingStyle
                    ? "Actualiza nombre y descripción del estilo."
                    : "Sube un PDF o DOCX adaptado para analizar tu estilo pedagógico."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-[#bccac1]/40 px-4 py-2 text-sm font-semibold text-[#3d4943]"
              >
                Cerrar
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-[#3d4943]">
                  Nombre del estilo
                </label>
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Ej. PT comprensión lectora"
                  className="w-full rounded-xl border border-[#bccac1]/40 bg-white px-4 py-3 text-sm outline-none focus:border-[#3eb489]"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-[#3d4943]">
                  Descripción
                </label>
                <input
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Cómo sueles adaptar este tipo de material"
                  className="w-full rounded-xl border border-[#bccac1]/40 bg-white px-4 py-3 text-sm outline-none focus:border-[#3eb489]"
                />
              </div>

              {!editingStyle ? (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-[#3d4943]">
                      Documento adaptado (PDF o DOCX)
                    </label>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          file: event.target.files?.[0] || null,
                        }))
                      }
                      className="w-full rounded-xl border border-[#bccac1]/40 bg-white px-4 py-3 text-sm outline-none focus:border-[#3eb489]"
                    />
                    <p className="mt-1 text-xs text-[#6d7a72]">
                      Tamaño máximo: 10MB.
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-semibold text-[#3d4943]">
                      Indicaciones para analizar este estilo (opcional)
                    </label>
                    <textarea
                      value={form.analysisInstructions}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          analysisInstructions: event.target.value,
                        }))
                      }
                      placeholder="Ej. Fíjate especialmente en la simplificación del lenguaje y en la secuenciación de tareas."
                      rows={4}
                      className="w-full rounded-xl border border-[#bccac1]/40 bg-white px-4 py-3 text-sm outline-none focus:border-[#3eb489]"
                    />
                  </div>

                  <label className="inline-flex items-center gap-3 rounded-full bg-[#f3f3f3] px-4 py-2">
                    <input
                      type="checkbox"
                      checked={form.showImprovements}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          showImprovements: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-[#bccac1] text-[#0B4FB3] focus:ring-[#86f8c8]"
                    />
                    <span className="text-sm font-semibold text-[#3d4943]">
                      Mostrar también puntos de mejora
                    </span>
                  </label>
                </>
              ) : null}
            </div>

            {formError ? (
              <p className="mt-4 rounded-lg border border-[#ffdad6] bg-[#ffdad6]/30 px-4 py-3 text-sm text-[#93000a]">
                {formError}
              </p>
            ) : null}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving || isAnalyzing}
                className="rounded-full border border-[#bccac1]/40 px-5 py-2 text-sm font-semibold text-[#3d4943] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveStyle}
                disabled={isSaving || isAnalyzing}
                className="rounded-full bg-[#0B4FB3] px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAnalyzing
                  ? "Analizando documento..."
                  : isSaving
                    ? "Guardando..."
                    : "Guardar estilo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 right-6 z-[70]">
          <div
            className={`rounded-xl border px-4 py-3 text-sm font-semibold shadow-xl ${
              toast.type === "success"
                ? "border-[#86f8c8]/60 bg-[#e9fff5] text-[#005139]"
                : "border-[#ffdad6] bg-[#fff3f1] text-[#93000a]"
            }`}
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </div>
  );
}
