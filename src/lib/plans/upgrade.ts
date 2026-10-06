import "server-only";
import type { EntitlementResult } from "@/lib/permissions/entitlements";
import { getPublicPlans } from "./public-plans";

/** CTA for a blocked entitlement: "Ver Pro" → /precios. Null when there is nothing to upgrade to. */
export async function getUpgradeCta(result: EntitlementResult): Promise<{ href: string; label: string } | null> {
  if (result.allowed || !result.upgradeTo) return null;
  const plan = (await getPublicPlans()).find((p) => p.slug === result.upgradeTo);
  return plan ? { href: "/precios", label: `Ver ${plan.name}` } : null;
}
