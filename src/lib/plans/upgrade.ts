import "server-only";
import type { EntitlementResult } from "@/lib/permissions/entitlements";
import { getPublicPlans } from "./public-plans";

/** Información del catálogo, nunca contratación: Stripe no está habilitado. */
export async function getUpgradeCta(result: EntitlementResult): Promise<{ href: string; label: string } | null> {
  if (result.allowed || !result.upgradeTo) return null;
  const plan = (await getPublicPlans()).find((p) => p.slug === result.upgradeTo);
  return plan ? { href: "/precios", label: "Consultar planes (contratación no disponible)" } : null;
}
