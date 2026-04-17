"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import { getCurrentUser, signInWithPassword, signUpWithPassword } from "@/lib/authService";

type Mode = "login" | "register";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

  useEffect(() => {
    const bootstrap = async () => {
      const user = await getCurrentUser().catch(() => null);
      if (user) {
        router.replace(next);
      }
    };

    void bootstrap();
  }, [next, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorMessage("");
    setInfoMessage("");

    if (!email.trim() || !password.trim()) {
      setErrorMessage("Email y contraseña son obligatorios.");
      return;
    }

    if (mode === "register") {
      if (password.length < 6) {
        setErrorMessage("La contraseña debe tener al menos 6 caracteres.");
        return;
      }

      if (password !== confirmPassword) {
        setErrorMessage("Las contraseñas no coinciden.");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      if (mode === "login") {
        await signInWithPassword({ email: email.trim(), password });
        router.replace(next);
      } else {
        const response = await signUpWithPassword({ email: email.trim(), password });

        if (response.user && response.session) {
          router.replace(next);
        } else {
          setInfoMessage(
            "Cuenta creada. Revisa tu correo para confirmar la cuenta antes de iniciar sesión.",
          );
          setMode("login");
        }
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No se pudo completar la autenticación.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-16"
      style={{ background: "var(--aa-cream, #FAF7F2)" }}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl bg-white px-8 py-10"
        style={{ boxShadow: "0 4px 24px rgba(44,59,45,0.08)" }}
      >
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <BrandLogo />
        </div>

        {/* Mode toggle pill */}
        <div
          className="mb-6 flex w-full rounded-full p-1"
          style={{ background: "#F0EDE8" }}
        >
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setErrorMessage("");
              setInfoMessage("");
            }}
            className="flex-1 rounded-full py-2 text-sm font-semibold transition-colors"
            style={
              mode === "login"
                ? { background: "var(--aa-green-dark, #4A7C59)", color: "#fff" }
                : { color: "var(--aa-text-muted, #6B7A6C)" }
            }
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setErrorMessage("");
              setInfoMessage("");
            }}
            className="flex-1 rounded-full py-2 text-sm font-semibold transition-colors"
            style={
              mode === "register"
                ? { background: "var(--aa-green-dark, #4A7C59)", color: "#fff" }
                : { color: "var(--aa-text-muted, #6B7A6C)" }
            }
          >
            Registrarse
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div>
            <label
              className="mb-1.5 block text-sm font-semibold"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="w-full rounded-2xl px-4 py-3 text-sm outline-none transition-shadow"
              style={{
                border: "1.5px solid #c8dcc8",
                color: "var(--aa-text, #2C3B2D)",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--aa-green, #7BAF7F)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(123,175,127,0.15)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#c8dcc8";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Password */}
          <div>
            <label
              className="mb-1.5 block text-sm font-semibold"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-2xl px-4 py-3 text-sm outline-none transition-shadow"
              style={{
                border: "1.5px solid #c8dcc8",
                color: "var(--aa-text, #2C3B2D)",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--aa-green, #7BAF7F)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(123,175,127,0.15)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#c8dcc8";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Confirm password — register only */}
          {mode === "register" ? (
            <div>
              <label
                className="mb-1.5 block text-sm font-semibold"
                style={{ color: "var(--aa-text, #2C3B2D)" }}
              >
                Repetir contraseña
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-2xl px-4 py-3 text-sm outline-none transition-shadow"
                style={{
                  border: "1.5px solid #c8dcc8",
                  color: "var(--aa-text, #2C3B2D)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--aa-green, #7BAF7F)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(123,175,127,0.15)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#c8dcc8";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>
          ) : null}

          {/* Error message */}
          {errorMessage ? (
            <div
              className="rounded-xl px-4 py-3 text-sm font-medium"
              style={{ background: "#FFF1F2", color: "#BE123C" }}
            >
              {errorMessage}
            </div>
          ) : null}

          {/* Info message */}
          {infoMessage ? (
            <div
              className="rounded-xl px-4 py-3 text-sm font-medium"
              style={{ background: "#F0FDF4", color: "#166534" }}
            >
              {infoMessage}
            </div>
          ) : null}

          {/* CTA button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 w-full rounded-full py-3 text-sm font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: "var(--aa-green-dark, #4A7C59)" }}
          >
            {isSubmitting
              ? "Procesando..."
              : mode === "login"
                ? "Entrar"
                : "Crear cuenta"}
          </button>
        </form>

        {/* Switch mode link */}
        <p
          className="mt-5 text-center text-sm"
          style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
        >
          {mode === "login" ? (
            <>
              ¿Sin cuenta?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("register");
                  setErrorMessage("");
                  setInfoMessage("");
                }}
                className="font-semibold underline-offset-2 hover:underline"
                style={{ color: "var(--aa-green-dark, #4A7C59)" }}
              >
                Regístrate gratis
              </button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setErrorMessage("");
                  setInfoMessage("");
                }}
                className="font-semibold underline-offset-2 hover:underline"
                style={{ color: "var(--aa-green-dark, #4A7C59)" }}
              >
                Inicia sesión
              </button>
            </>
          )}
        </p>

        {/* Footer legal links */}
        <p
          className="mt-6 text-center text-xs"
          style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
        >
          Al registrarte aceptas nuestros{" "}
          <Link
            href="/legal/terms"
            className="font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--aa-green-dark, #4A7C59)" }}
          >
            Términos
          </Link>
          {" "}y{" "}
          <Link
            href="/legal/privacy"
            className="font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--aa-green-dark, #4A7C59)" }}
          >
            Privacidad
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-screen items-center justify-center text-sm"
          style={{ background: "var(--aa-cream, #FAF7F2)", color: "var(--aa-text-muted, #6B7A6C)" }}
        >
          Cargando acceso...
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
