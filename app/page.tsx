"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/useToast";
import type { Subject, SupportDegree, LearningProfile } from "@/lib/adaptationRules";

import UploadScreen from "@/components/screens/UploadScreen";
import ConfigScreen from "@/components/screens/ConfigScreen";
import GeneratingScreen from "@/components/screens/GeneratingScreen";
import ResultScreen from "@/components/screens/ResultScreen";
import ResultError from "@/components/ui/ResultError";
import SubscriptionScreen from "@/components/screens/SubscriptionScreen";
import ProGateModal from "@/components/ui/ProGateModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = "upload" | "configure" | "generating" | "result" | "subscription";
type Tab = "paste" | "file";
type Perfil = LearningProfile;

type FileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; fileName: string; fullText: string }
  | { status: "error"; message: string };

type AdaptResult = {
  documentHtml: string;
  teacherNotes: string[];
  adaptationDecisions: unknown[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

// ─── Secondary-level heuristic ───────────────────────────────────────────────

function detectsSecondaryLevel(text: string): boolean {
  const signals = [
    /\b(ESO|bachillerato|2º ESO|3º ESO|4º ESO)\b/i,
    /\b(ecuaci[oó]n de segundo grado|sistemas de ecuaciones|factorizaci[oó]n)\b/i,
    /\b(derivada|integral|logaritmo|trigonometr[ií]a)\b/i,
    /\b(hist[oó]ria de (espa[nñ]a|europa)|filosof[ií]a|geolog[ií]a)\b/i,
    /x[²2]|ax\s*\+\s*b|discriminante/i,
  ];
  return signals.some((r) => r.test(text));
}

// ─── Style injection helper ───────────────────────────────────────────────────

function injectAndStripStyles(html: string): string {
  // Match <style> or <style id="..."> (the generated CSS has an id attribute)
  const match = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (!match) return html;
  const existing = document.getElementById("aa-document-styles");
  if (existing) existing.remove();
  const el = document.createElement("style");
  el.id = "aa-document-styles";
  el.textContent = match[1];
  document.head.appendChild(el);
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/i, "").trim();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { toast } = useToast();

  // ── Screen ───────────────────────────────────────────────────────────────────
  const [screen, setScreen] = useState<Screen>("upload");

  // ── Plan + auth state (cargado una vez al montar) ────────────────────────────
  const [userPlan, setUserPlan] = useState<"free" | "pro" | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { setUserPlan("free"); return; }
        setUserEmail(session.user.email ?? null);
        const { data } = await supabase
          .from("subscriptions")
          .select("plan, status, current_period_end")
          .eq("user_id", session.user.id)
          .eq("status", "active")
          .maybeSingle();
        const row = data as { plan?: string; current_period_end?: string } | null;
        if (row?.plan === "pro") {
          const notExpired = !row.current_period_end || new Date(row.current_period_end) > new Date();
          setUserPlan(notExpired ? "pro" : "free");
        } else {
          setUserPlan("free");
        }
      } catch {
        setUserPlan("free");
      }
    })();
  }, []);

  // ── Modal state (Pro gate) ───────────────────────────────────────────────────
  const [showTrialModal, setShowTrialModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // ── Upload state ─────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>("file");
  const [pastedText, setPastedText] = useState("");
  const [fileState, setFileState] = useState<FileState>({ status: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const content =
    tab === "paste"
      ? pastedText.trim()
      : fileState.status === "done"
        ? fileState.fullText
        : "";

  // ── Configure state ───────────────────────────────────────────────────────────
  const [perfil, setPerfil] = useState<Perfil>("dislexia");
  const [subject, setSubject] = useState<Subject>("lengua");
  const [supportDegree, setSupportDegree] = useState<SupportDegree>("medio");
  const [interestsInput, setInterestsInput] = useState("");
  const [configError, setConfigError] = useState("");
  const [educationalLevel, setEducationalLevel] = useState<"primaria" | "secundaria">("primaria");
  const [showSecondaryWarning, setShowSecondaryWarning] = useState(false);

  // ── Generation progress (0-100, streaming real) ──────────────────────────────
  const [generationProgress, setGenerationProgress] = useState<number>(0);

  // ── Result state ──────────────────────────────────────────────────────────────
  const [adaptResult, setAdaptResult] = useState<AdaptResult | null>(null);
  const [cleanHtml, setCleanHtml] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [adaptError, setAdaptError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [docxBusy, setDocxBusy] = useState(false);
  const [docxError, setDocxError] = useState("");
  const savedAdaptationIdRef = useRef<string | null>(null);

  // Inject / clean up styles when entering or leaving result screen
  useEffect(() => {
    if (screen === "result" && adaptResult) {
      setCleanHtml(injectAndStripStyles(adaptResult.documentHtml));
    } else {
      document.getElementById("aa-document-styles")?.remove();
    }
  }, [screen, adaptResult]);

  // Stagger-animate aa-block elements into view on result screen
  useEffect(() => {
    if (screen !== "result") return;
    const timer = setTimeout(() => {
      const blocks = document.querySelectorAll(".aa-block");
      blocks.forEach((block, i) => {
        setTimeout(() => block.classList.add("visible"), i * 120);
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [screen]);

  // ── File extraction ───────────────────────────────────────────────────────────
  const extractFile = useCallback(async (file: File) => {
    const name = file.name.toLowerCase();
    const mime = file.type.toLowerCase();
    const ok =
      mime === "application/pdf" || name.endsWith(".pdf") ||
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx");

    if (!ok) {
      setFileState({ status: "error", message: "Solo se aceptan archivos PDF o DOCX." });
      return;
    }

    setFileState({ status: "loading" });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/extract-text", { method: "POST", body: formData });
      const json = await res.json() as { text?: string; error?: string };
      if (!res.ok || !json.text) {
        setFileState({ status: "error", message: "No se pudo leer el archivo. Comprueba que no está protegido con contraseña e inténtalo de nuevo." });
        return;
      }
      setFileState({ status: "done", fullText: json.text, fileName: file.name });
    } catch {
      setFileState({ status: "error", message: "Error de red al extraer el texto." });
    }
  }, []);

  const handleDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void extractFile(file);
  }, [extractFile]);
  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void extractFile(file);
  }, [extractFile]);

  // ── Navigate upload → configure ───────────────────────────────────────────────
  const handleContinue = () => {
    if (detectsSecondaryLevel(content)) setShowSecondaryWarning(true);
    setScreen("configure");
  };

  // ── Generate ──────────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    setConfigError("");
    setAdaptError(null);
    setGenerationProgress(0);
    setScreen("generating");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const studentInterests = interestsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch("/api/adapt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          content,
          subject,
          learningProfile: perfil,
          supportDegree,
          studentInterests,
          educationalLevel,
        }),
      });

      // Errores HTTP antes del stream (ej: 400, 402, 429 por rate limit o plan)
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as {
          error?: string;
          code?: string;
          retryAfter?: number;
        };
        if (res.status === 429) {
          const wait = errData.retryAfter ?? 60;
          toast(
            `Has alcanzado el límite de adaptaciones. Espera ${wait} segundos.`,
            "warning",
          );
          setScreen("configure");
        } else if (res.status === 402 && errData.code === "FREE_TRIAL_EXHAUSTED") {
          setScreen("configure");
          setShowTrialModal(true);
        } else {
          setConfigError(errData.error ?? "No se pudo generar la adaptación. Inténtalo de nuevo.");
          setScreen("configure");
        }
        return;
      }

      if (!res.body) {
        setConfigError("Error de red: respuesta sin contenido.");
        setScreen("configure");
        return;
      }

      // Leer stream SSE
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: AdaptResult | null = null;

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;

          let event: { type: string; progress?: number; documentHtml?: string; teacherNotes?: string[]; adaptationDecisions?: unknown[]; pictogramConcepts?: string[]; message?: string };
          try {
            event = JSON.parse(payload) as typeof event;
          } catch {
            continue;
          }

          if (event.type === "delta" && typeof event.progress === "number") {
            setGenerationProgress(event.progress);
          } else if (event.type === "done") {
            result = {
              documentHtml: event.documentHtml ?? "",
              teacherNotes: event.teacherNotes ?? [],
              adaptationDecisions: event.adaptationDecisions ?? [],
            };
            // Mark anonymous trial as used via cookie so the server can check it next time.
            // Authenticated users are tracked via DB; this cookie only matters for anonymous.
            document.cookie = "aa-trial=1; max-age=31536000; path=/; SameSite=Lax";
            break outer;
          } else if (event.type === "error") {
            setAdaptError(event.message ?? "No se pudo generar la adaptación. Inténtalo de nuevo.");
            setScreen("result");
            return;
          }
        }
      }

      if (!result?.documentHtml) {
        setAdaptError("No se pudo generar la adaptación. Inténtalo de nuevo.");
        setScreen("result");
        return;
      }

      savedAdaptationIdRef.current = null;
      setGenerationProgress(100);
      setAdaptResult(result);
      setScreen("result");
    } catch {
      setAdaptError("Error de red al generar la adaptación. Inténtalo de nuevo.");
      setScreen("result");
    }
  };

  // ── Reset ─────────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setPastedText("");
    setFileState({ status: "idle" });
    setTab("file");
    setPerfil("dislexia");
    setSubject("lengua");
    setSupportDegree("medio");
    setInterestsInput("");
    setConfigError("");
    setAdaptError(null);
    setEducationalLevel("primaria");
    setShowSecondaryWarning(false);
    setAdaptResult(null);
    setCleanHtml("");
    setDocxError("");
    savedAdaptationIdRef.current = null;
    setScreen("upload");
  };

  // ── PDF (server-side via /api/export/pdf) ────────────────────────────────────
  const handlePdf = async () => {
    if (!adaptResult || pdfBusy) return;
    if (userPlan !== "pro") { setShowExportModal(true); return; }
    setPdfBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setShowExportModal(true);
        return;
      }

      // Reuse the same saved record as DOCX to avoid duplicate inserts
      let adaptationId = savedAdaptationIdRef.current;
      if (!adaptationId) {
        const { data: inserted, error: insertError } = await supabase
          .from("adaptations")
          .insert({ result_html: adaptResult.documentHtml })
          .select("id")
          .single();
        const row = inserted as Record<string, unknown> | null;
        if (insertError || !row?.id) {
          toast("No se pudo guardar la adaptación para la descarga.", "error");
          return;
        }
        adaptationId = String(row.id);
        savedAdaptationIdRef.current = adaptationId;
      }

      const res = await fetch("/api/export/pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ adaptationId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error desconocido" })) as { error?: string };
        toast(err.error ?? "No se pudo generar el PDF.", "error");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "adaptacion-adaptaula.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast("Error de red al descargar el PDF.", "error");
    } finally {
      setPdfBusy(false);
    }
  };

  // ── DOCX ──────────────────────────────────────────────────────────────────────
  const handleDocx = async () => {
    if (!adaptResult || docxBusy) return;
    if (userPlan !== "pro") { setShowExportModal(true); return; }
    setDocxBusy(true);
    setDocxError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        // No auth → show export modal
        setDocxBusy(false);
        setShowExportModal(true);
        return;
      }

      let adaptationId = savedAdaptationIdRef.current;
      if (!adaptationId) {
        const { data: inserted, error: insertError } = await supabase
          .from("adaptations")
          .insert({ result_html: adaptResult.documentHtml })
          .select("id")
          .single();
        const row = inserted as Record<string, unknown> | null;
        if (insertError || !row?.id) {
          setDocxError("No se pudo guardar la adaptación para la descarga.");
          setDocxBusy(false);
          return;
        }
        adaptationId = String(row.id);
        savedAdaptationIdRef.current = adaptationId;
      }

      const res = await fetch("/api/export/docx", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ adaptationId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error desconocido" })) as { error?: string };
        setDocxError(err.error ?? "No se pudo generar el DOCX.");
        setDocxBusy(false);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "adaptacion-adaptaula.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDocxError("Error de red al descargar el DOCX.");
    } finally {
      setDocxBusy(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (screen === "generating") {
    return (
      <GeneratingScreen
        perfil={perfil}
        subject={subject}
        supportDegree={supportDegree}
        progress={generationProgress > 0 ? generationProgress : undefined}
      />
    );
  }

  if (screen === "result" && adaptError) {
    return (
      <ResultError
        message={adaptError}
        onBack={() => { setAdaptError(null); setScreen("configure"); }}
        onRetry={() => { setAdaptError(null); void handleGenerate(); }}
      />
    );
  }

  if (screen === "result" && adaptResult) {
    return (
      <ErrorBoundary onError={(err) => toast(err.message, "error")}>
        <ResultScreen
          cleanHtml={cleanHtml}
          teacherNotes={adaptResult.teacherNotes}
          pdfBusy={pdfBusy}
          docxBusy={docxBusy}
          docxError={docxError}
          notesOpen={notesOpen}
          perfil={perfil}
          subject={subject}
          supportDegree={supportDegree}
          isPro={userPlan === "pro"}
          onReset={handleReset}
          onPdf={() => void handlePdf()}
          onDocx={() => void handleDocx()}
          onToggleNotes={() => setNotesOpen((o) => !o)}
          onUpgrade={() => setScreen("subscription")}
        />
        {showExportModal && (
          <ProGateModal
            variant="export-locked"
            onUpgrade={() => { setShowExportModal(false); setScreen("subscription"); }}
            onClose={() => setShowExportModal(false)}
          />
        )}
      </ErrorBoundary>
    );
  }

  if (screen === "subscription") {
    return (
      <SubscriptionScreen
        onBack={() => setScreen(adaptResult ? "result" : "upload")}
      />
    );
  }

  if (screen === "upload") {
    return (
      <UploadScreen
        tab={tab}
        pastedText={pastedText}
        fileState={fileState}
        isDragging={isDragging}
        fileInputRef={fileInputRef}
        onTabChange={setTab}
        onPastedTextChange={setPastedText}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onFileInput={handleFileInput}
        onContinue={handleContinue}
        canContinue={!!content}
        userEmail={userEmail}
        userPlan={userPlan}
        onUpgrade={() => setScreen("subscription")}
      />
    );
  }

  // screen === "configure"
  return (
    <ErrorBoundary onError={(err) => toast(err.message, "error")}>
      <ConfigScreen
        perfil={perfil}
        subject={subject}
        supportDegree={supportDegree}
        interestsInput={interestsInput}
        educationalLevel={educationalLevel}
        configError={configError}
        showSecondaryWarning={showSecondaryWarning}
        onPerfilChange={setPerfil}
        onSubjectChange={setSubject}
        onSupportDegreeChange={setSupportDegree}
        onInterestsChange={setInterestsInput}
        onEducationalLevelChange={setEducationalLevel}
        onBack={() => { setScreen("upload"); setConfigError(""); }}
        onGenerate={() => void handleGenerate()}
        onDismissWarning={() => setShowSecondaryWarning(false)}
        onBackFromWarning={() => { setShowSecondaryWarning(false); setScreen("upload"); setConfigError(""); }}
      />
      {showTrialModal && (
        <ProGateModal
          variant="trial-exhausted"
          onUpgrade={() => { setShowTrialModal(false); setScreen("subscription"); }}
          onClose={() => { setShowTrialModal(false); setScreen("upload"); handleReset(); }}
        />
      )}
    </ErrorBoundary>
  );
}
