"use client";

import { type RefObject } from "react";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

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

function UploadIcon({ size = 22, color = "#E8834A" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      <path d="M7 9l5-5 5 5" />
      <path d="M12 4v12" />
    </svg>
  );
}

function CheckCircleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function FormatBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ border: "0.5px solid #D5CFC6", color: "#8A8070" }}
    >
      {label}
    </span>
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
    <div className="flex min-h-screen flex-col" style={{ background: "#FEFCF9" }}>
      {/* ── Nav top ── */}
      <nav
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "0.5px solid #EDE8E0" }}
      >
        <BrandLogo compact />

        <div className="flex items-center gap-3">
          {userPlan !== undefined && (
            <button
              type="button"
              onClick={onUpgrade}
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background: userPlan === "pro" ? "#FEF3EC" : "#F2EEE8",
                color: userPlan === "pro" ? "#E8834A" : "#8A8070",
                border: "0.5px solid #EDE8E0",
                transition: "all 0.15s",
              }}
            >
              {userPlan === "pro" ? "Pro" : "Free"}
            </button>
          )}
          {userEmail ? (
            <Link
              href="/account"
              className="flex items-center justify-center rounded-full"
              style={{ width: 30, height: 30, background: "#F2EEE8", color: "#8A8070", transition: "all 0.15s" }}
            >
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ border: "0.5px solid #EDE8E0", color: "#8A8070", transition: "all 0.15s" }}
            >
              Iniciar sesión
            </Link>
          )}
        </div>
      </nav>

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-10">
        <h1 className="mb-1.5 text-center" style={{ fontSize: 22, fontWeight: 500, color: "#2C2620" }}>
          Adapta tu material escolar
        </h1>
        <p className="mb-7 text-center" style={{ fontSize: 13, color: "#8A8070" }}>
          Sube un documento y lo adaptamos en segundos
        </p>

        <div className="w-full max-w-[520px]">
          {/* Tab toggle */}
          <div className="mb-5 flex justify-center">
            <div className="flex gap-1 p-1" style={{ background: "#F2EEE8", borderRadius: 10 }}>
              {(["file", "paste"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onTabChange(t)}
                  className="px-5 py-1.5 text-sm font-medium"
                  style={{
                    borderRadius: 8,
                    transition: "all 0.15s",
                    ...(tab === t
                      ? { background: "#fff", color: "#2C2620", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }
                      : { background: "transparent", color: "#8A8070" }),
                  }}
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
                className="flex w-full cursor-pointer flex-col items-center px-8 py-10"
                style={{
                  borderRadius: 14,
                  border: isDragging ? "1.5px dashed #E8834A" : "1.5px solid transparent",
                  background: isDragging ? "#FEFAF7" : "#FEFCF9",
                  transition: "all 0.25s ease",
                }}
              >
                <div
                  className="mb-4 flex items-center justify-center"
                  style={{
                    width: 52,
                    height: 52,
                    background: "#FEF3EC",
                    animation: "blobFloat 4s ease-in-out infinite",
                  }}
                >
                  <UploadIcon />
                </div>
                <p style={{ fontSize: 14, fontWeight: 500, color: "#2C2620" }}>
                  {isDragging ? "Suelta aquí el documento" : "Arrastra tu documento aquí"}
                </p>
                <p className="mt-1" style={{ fontSize: 12, color: "#8A8070" }}>o haz clic para seleccionar</p>
                <span
                  className="mt-4 inline-flex items-center px-4 py-2 text-xs font-semibold text-white"
                  style={{ background: "#E8834A", borderRadius: 8, transition: "all 0.15s" }}
                >
                  Seleccionar archivo
                </span>
                <div className="mt-4 flex items-center gap-2">
                  <FormatBadge label="PDF" />
                  <FormatBadge label="DOCX" />
                  <FormatBadge label="JPG" />
                </div>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.jpg,.jpeg"
                onChange={onFileInput}
                className="sr-only"
              />

              {fileState.status === "loading" && (
                <div
                  className="flex items-center gap-2.5 px-4 py-3 text-sm"
                  style={{ borderRadius: 12, border: "0.5px solid #EDE8E0", background: "#fff", color: "#8A8070" }}
                >
                  <span
                    className="inline-block h-4 w-4 animate-spin rounded-full"
                    style={{ border: "2px solid #EDE8E0", borderTopColor: "#E8834A" }}
                  />
                  Extrayendo texto...
                </div>
              )}

              {fileState.status === "done" && (
                <div
                  className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium"
                  style={{ borderRadius: 12, border: "0.5px solid #b8d8b8", background: "#f0f7f0", color: "#4A7C59" }}
                >
                  <CheckCircleIcon />
                  {fileState.fileName}
                </div>
              )}

              {fileState.status === "error" && (
                <div
                  className="px-4 py-3 text-sm"
                  style={{ borderRadius: 12, border: "0.5px solid #f5c6c6", background: "#fef2f2", color: "#c53030" }}
                >
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
              className="w-full resize-none px-5 py-4 text-sm outline-none"
              style={{
                borderRadius: 14,
                border: "1.5px solid #DDD8D0",
                background: "#fff",
                color: "#2C2620",
                lineHeight: 1.7,
                transition: "all 0.15s",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#E8834A";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(232,131,74,0.15)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#DDD8D0";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          )}

          {/* CTA */}
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="mt-5 w-full py-3.5 text-sm font-bold text-white"
            style={{
              borderRadius: 20,
              background: canContinue ? "#E8834A" : "#D4C8BD",
              cursor: canContinue ? "pointer" : "not-allowed",
              boxShadow: canContinue ? "0 4px 14px rgba(232,131,74,0.30)" : "none",
              transition: "all 0.15s",
            }}
          >
            Continuar
          </button>
        </div>
      </div>

      <style>{`
        @keyframes blobFloat {
          0%, 100% { border-radius: 42% 58% 55% 45% / 50% 45% 55% 50%; transform: translateY(0); }
          33%  { border-radius: 55% 45% 40% 60% / 45% 55% 50% 50%; transform: translateY(-4px); }
          66%  { border-radius: 48% 52% 58% 42% / 55% 42% 58% 45%; transform: translateY(2px); }
        }
      `}</style>
    </div>
  );
}
