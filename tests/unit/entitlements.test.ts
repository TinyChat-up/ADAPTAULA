import { describe, expect, it } from "vitest";
import { evaluateEntitlement } from "@/lib/permissions/entitlements";
import { nextPlan } from "@/lib/plans/next-plan";
import type { PublicPlan } from "@/lib/schemas/plan";

const free = { max_profiles: 2, max_classes: 0, analyses: { used: 0, limit: 10 } };
const pro = { max_profiles: 30, max_classes: 10, analyses: { used: 0, limit: 100 } };
const base = { role: "owner" as const, counts: { profiles: 0, classes: 0 }, upgradeTo: "pro" };

describe("evaluateEntitlement", () => {
  it("allows creating a profile under the plan limit and reports what is left", () => {
    expect(evaluateEntitlement({ ...base, action: "profile.create", usage: free, counts: { profiles: 1, classes: 0 } })).toEqual({
      allowed: true,
      remaining: 1,
    });
  });

  it("blocks Free at 2 profiles and suggests the next plan", () => {
    expect(evaluateEntitlement({ ...base, action: "profile.create", usage: free, counts: { profiles: 2, classes: 0 } })).toEqual({
      allowed: false,
      reason: "limit_reached",
      limit: 2,
      used: 2,
      upgradeTo: "pro",
    });
  });

  it("takes the limit from the plan, not from constants", () => {
    const r = evaluateEntitlement({ ...base, action: "profile.create", usage: pro, counts: { profiles: 29, classes: 0 } });
    expect(r).toEqual({ allowed: true, remaining: 1 });
  });

  it("blocks classes on a plan without them", () => {
    expect(evaluateEntitlement({ ...base, action: "class.create", usage: free }).allowed).toBe(false);
  });

  it("analysis.start reads the monthly analysis meter of the plan, not the profile or class limits", () => {
    const usage = (used: number, limit: number) => ({ ...free, analyses: { used, limit } });
    expect(evaluateEntitlement({ ...base, action: "analysis.start", usage: usage(9, 10) })).toEqual({ allowed: true, remaining: 1 });
    expect(evaluateEntitlement({ ...base, action: "analysis.start", usage: usage(10, 10) })).toEqual({
      allowed: false,
      reason: "limit_reached",
      limit: 10,
      used: 10,
      upgradeTo: "pro",
    });
    // A plan without analyses blocks them (the database fails closed the same way).
    expect(evaluateEntitlement({ ...base, action: "analysis.start", usage: usage(0, 0) }).allowed).toBe(false);
  });

  it("denies viewers regardless of quota", () => {
    expect(evaluateEntitlement({ ...base, role: "viewer", action: "profile.create", usage: pro })).toMatchObject({
      allowed: false,
      reason: "role",
      upgradeTo: null,
    });
  });
});

describe("nextPlan", () => {
  const plan = (slug: string, sort_order: number) => ({ slug, sort_order }) as PublicPlan;
  const plans = [plan("pro", 20), plan("free", 10), plan("max", 30)];

  it("returns the next plan on sale", () => expect(nextPlan(plans, "free")?.slug).toBe("pro"));
  it("returns null for the top plan or an unknown one", () => {
    expect(nextPlan(plans, "max")).toBeNull();
    expect(nextPlan(plans, "otro")).toBeNull();
  });
  it("skips plans that are not on sale", () => expect(nextPlan([plan("free", 10), plan("pro", 20)], "pro")).toBeNull());
});
