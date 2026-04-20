"use client";

import { type RefObject } from "react";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import PlanStatusBanner from "@/components/ui/PlanStatusBanner";

type Tab = "paste" | "file";
type FileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; fileName: string; fullText: string }
  | { status: "error"; message: string };

interface Props {
  tab: Tab;
  pastedText: string;
  fileState: FileState;
  isDragging: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onTabChange: (tab: Tab) => void;
  onPastedTextChange: (text: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onContinue: () => void;
  canContinue: boolean;
  userEmail?: string | null;
  userPlan?: "free" | "pro" | null;
  onUpgrade?: () => void;
}

function DocumentIcon({ active }: { active: boolean }) {
  const stroke = active ? "#4A7C59" : "#7BAF7F";
  return (
    <svg
      className="mx-auto h-14 w-14"
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="10" y="6" width="28" height="36" rx="4" stroke={stroke} strokeWidth="2" fill={active ? "rgba(123,175,127,0.12)" : "white"} />
      <path d="M32 6v10h10" stroke={stroke} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M17 22h18M17 28h12" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
      <path d="M28 48l-5-5m5 5l5-5m-5 5V38" stroke={active ? "#4A7C59" : "#9DC49E"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function UploadScreen({
  tab,
  pastedText,
  fileState,
  isDragging,
  fileInputRef,
  onTabChange,
  onPastedTextChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
  onContinue,
  canContinue,
  userEmail,
  userPlan,
  onUpgrade,
}: Props) {
  return (
    <div className="aa-screen flex flex-col items-center justify-center px-4 py-14">

      {/* ── Auth nav ── */}
      <div className="absolute top-4 right-4">
        {userEmail ? (
          <Link
            href="/account"
            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:bg-black/5"
            style={{ borderColor: "#c8dcc8", color: "var(--aa-text-muted)" }}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            Mi cuenta
          </Link>
        ) : (
          <Link
            href="/login"
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition hover:bg-black/5"
            style={{ borderColor: "#c8dcc8", color: "var(--aa-text-muted)" }}
          >
            Iniciar sesión
          </Link>
        )}
      </div>

      {/* Logo */}
      <div className="mb-6 text-center">
        <BrandLogo />
        <p className="mt-2 text-sm" style={{ color: "var(--aa-text-muted)" }}>
          Adapta material escolar en segundos
        </p>
      </div>

      {/* Plan status banner — solo si el plan ya se conoce (no undefined) */}
      {userPlan !== undefined && onUpgrade && (
        <PlanStatusBanner
          currentPlan={userPlan ?? null}
          onUpgrade={onUpgrade}
        />
      )}

      <div className="w-full max-w-[580px]">
        {/* Tab toggle */}
        <div className="mb-5 flex justify-center">
          <div className="flex rounded-full p-1" style={{ background: "rgba(123,175,127,0.12)" }}>
            {(["file", "paste"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTabChange(t)}
                className="rounded-full px-5 py-1.5 text-sm font-medium transition-all"
                style={
                  tab === t
                    ? { background: "var(--aa-green)", color: "#fff" }
                    : { color: "var(--aa-text-muted)" }
                }
              >
                {t === "file" ? "Subir archivo" : "Pegar texto"}
              </button>
            ))}
          </div>
        </div>

        {/* File drop zone */}
        {tab === "file" && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={`w-full rounded-3xl px-8 py-16 text-center cursor-pointer transition-all ${
                isDragging ? "aa-dropzone-active" : "aa-dropzone-idle"
              }`}
              style={{ minHeight: 280 }}
            >
              <DocumentIcon active={isDragging} />
              <p
                className="mt-5 text-base font-semibold"
                style={{ color: isDragging ? "var(--aa-green-dark)" : "var(--aa-text)" }}
              >
                {isDragging ? "Suelta aquí el documento" : "Arrastra tu documento aquí"}
              </p>
              <p className="mt-1.5 text-sm" style={{ color: "var(--aa-text-muted)" }}>
                o haz clic para seleccionar
              </p>
              <p className="mt-1 text-xs" style={{ color: "#9aaa9b" }}>
                PDF o DOCX · máx. 10 MB
              </p>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              onChange={onFileInput}
              className="sr-only"
            />

            {fileState.status === "loading" && (
              <div className="flex items-center gap-2.5 rounded-2xl border border-[#c8dcc8] bg-white px-4 py-3 text-sm" style={{ color: "var(--aa-text-muted)" }}>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#c8dcc8] border-t-[#7BAF7F]" />
                Extrayendo texto del documento...
              </div>
            )}
            {fileState.status === "done" && (
              <div className="flex items-center gap-2.5 rounded-2xl border border-[#b8d8b8] bg-[#f0f7f0] px-4 py-3 text-sm font-medium" style={{ color: "var(--aa-green-dark)" }}>
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {fileState.fileName}
              </div>
            )}
            {fileState.status === "error" && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {fileState.message}
              </div>
            )}
          </div>
        )}

        {/* Paste textarea */}
        {tab === "paste" && (
          <textarea
            value={pastedText}
            onChange={(e) => onPastedTextChange(e.target.value)}
            rows={9}
            placeholder="Pega aquí el contenido del material escolar..."
            className="w-full rounded-2xl border border-[#c8dcc8] bg-white px-5 py-4 text-sm outline-none resize-none transition"
            style={{ color: "var(--aa-text)", lineHeight: 1.7 }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--aa-green)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(123,175,127,0.15)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "#c8dcc8";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        )}

        {/* CTA */}
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="mt-5 w-full rounded-full py-3.5 text-sm font-bold text-white transition-all"
          style={{
            background: canContinue
              ? "linear-gradient(135deg, var(--aa-orange) 0%, #f0a060 100%)"
              : "#d4c8bd",
            cursor: canContinue ? "pointer" : "not-allowed",
            boxShadow: canContinue ? "0 4px 14px rgba(232,131,74,0.30)" : "none",
          }}
        >
          Continuar
        </button>
      </div>
    </div>
  );
}
