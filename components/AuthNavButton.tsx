"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getCurrentUser, onAuthStateChange, signOut } from "@/lib/authService";

type Props = {
  loginClassName: string;
  logoutClassName?: string;
  loginLabel?: string;
  logoutLabel?: string;
};

export default function AuthNavButton({
  loginClassName,
  logoutClassName,
  loginLabel = "Iniciar sesión",
  logoutLabel = "Cerrar sesión",
}: Props) {
  const router = useRouter();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const user = await getCurrentUser();
        if (mounted) setHasSession(Boolean(user));
      } catch {
        if (mounted) setHasSession(false);
      }
    };

    void init();

    const { data } = onAuthStateChange((_event, user) => {
      setHasSession(Boolean(user));
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  if (hasSession === null) {
    return (
      <button type="button" disabled className={loginClassName}>
        Cargando...
      </button>
    );
  }

  if (!hasSession) {
    return (
      <button
        type="button"
        className={loginClassName}
        onClick={() => router.push("/login")}
      >
        {loginLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={isWorking}
      className={logoutClassName || loginClassName}
      onClick={async () => {
        if (isWorking) return;
        setIsWorking(true);
        try {
          await signOut();
          router.push("/login");
        } finally {
          setIsWorking(false);
        }
      }}
    >
      {isWorking ? "Saliendo..." : logoutLabel}
    </button>
  );
}
