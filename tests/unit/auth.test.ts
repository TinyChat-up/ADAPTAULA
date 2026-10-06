import { describe, expect, it } from "vitest";
import { isAuthPage, isProtectedPath, safeNextPath } from "@/lib/auth/paths";
import { hasRole, pickWorkspace, type Membership } from "@/lib/auth/workspace-select";

describe("safeNextPath (open-redirect protection)", () => {
  it.each(["/app", "/app/alumnos?x=1", "/precios"])("keeps %s", (p) => expect(safeNextPath(p)).toBe(p));
  it.each(["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "evil", "", null, undefined, "/a\nb"])(
    "rejects %j",
    (p) => expect(safeNextPath(p)).toBe("/app"),
  );
});

describe("route guards", () => {
  it("protects the app and admin, not marketing", () => {
    expect(isProtectedPath("/app")).toBe(true);
    expect(isProtectedPath("/app/alumnos/123")).toBe(true);
    expect(isProtectedPath("/admin")).toBe(true);
    expect(isProtectedPath("/application")).toBe(false);
    expect(isProtectedPath("/precios")).toBe(false);
  });

  it("keeps reset-password reachable for a signed-in user", () => {
    expect(isAuthPage("/login")).toBe(true);
    expect(isAuthPage("/reset-password")).toBe(false);
  });
});

describe("pickWorkspace", () => {
  const personal: Membership = { role: "owner", workspace: { id: "p", name: "Mi espacio", type: "personal" } };
  const school: Membership = { role: "teacher", workspace: { id: "s", name: "Colegio", type: "school" } };

  it("defaults to the personal workspace", () => expect(pickWorkspace([school, personal])).toBe(personal));
  it("honors a cookie that matches a membership", () => expect(pickWorkspace([personal, school], "s")).toBe(school));
  it("ignores a forged cookie", () => expect(pickWorkspace([personal], "otro-workspace")).toBe(personal));
  it("returns null without memberships", () => expect(pickWorkspace([], "p")).toBeNull());
  it("checks roles", () => {
    expect(hasRole("viewer", ["owner", "admin", "teacher"])).toBe(false);
    expect(hasRole("teacher", ["owner", "admin", "teacher"])).toBe(true);
  });
});
