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
    <div className="min-h-screen bg-[#f7f9ff] text-[#1a1c1c]">
      <nav className="w-full border-b border-[#bccac1]/30 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-8 py-4">
          <Link href="/" className="text-2xl font-black tracking-tight text-[#0B4FB3]"><BrandLogo compact /></Link>
          <Link
            href="/"
            className="rounded-full border border-[#bccac1]/40 px-5 py-2 text-sm font-semibold text-[#3d4943]"
          >
            Volver
          </Link>
        </div>
      </nav>

      <main className="mx-auto flex max-w-7xl items-center justify-center px-8 py-16">
        <section className="w-full max-w-md rounded-2xl border border-[#bccac1]/30 bg-white p-8 shadow-[0_20px_40px_rgba(26,28,28,0.05)]">
          <h1 className="font-sans text-3xl font-extrabold tracking-tight">
            {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </h1>
          <p className="mt-2 text-sm text-[#3d4943]">
            {mode === "login"
              ? "Accede para crear y gestionar adaptaciones reales."
              : "Regístrate para guardar estilos, historial y adaptaciones."}
          </p>

          <div className="mt-6 inline-flex rounded-full bg-[#f3f3f3] p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-full px-4 py-2 text-sm font-bold ${
                mode === "login" ? "bg-[#0B4FB3] text-white" : "text-[#3d4943]"
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`rounded-full px-4 py-2 text-sm font-bold ${
                mode === "register" ? "bg-[#0B4FB3] text-white" : "text-[#3d4943]"
              }`}
            >
              Registro
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-[#3d4943]">Email</label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-[#bccac1]/40 px-4 py-3 text-sm outline-none focus:border-[#3eb489]"
                placeholder="tu@email.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-[#3d4943]">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-[#bccac1]/40 px-4 py-3 text-sm outline-none focus:border-[#3eb489]"
                placeholder="••••••••"
              />
            </div>

            {mode === "register" ? (
              <div>
                <label className="mb-1 block text-sm font-semibold text-[#3d4943]">
                  Repetir contraseña
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-xl border border-[#bccac1]/40 px-4 py-3 text-sm outline-none focus:border-[#3eb489]"
                  placeholder="••••••••"
                />
              </div>
            ) : null}

            {errorMessage ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {errorMessage}
              </p>
            ) : null}

            {infoMessage ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                {infoMessage}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-full bg-[#0B4FB3] py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting
                ? "Procesando..."
                : mode === "login"
                  ? "Entrar"
                  : "Crear cuenta"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f7f9ff] text-[#1a1c1c]">
          Cargando acceso...
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
