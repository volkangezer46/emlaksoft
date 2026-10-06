import { describe, expect, it } from "vitest";
import {
  canChangeScope,
  canCreateOverride,
  canEditPermissionOverride,
  defaultOverrideExpiry,
  isCustomScope,
  isOverrideExpired,
  normalizeScopeInput,
  type ScopeInput,
} from "./admin-rules";

const NOW = Date.UTC(2026, 9, 6, 9, 0, 0);
const UUID = "11111111-2222-4333-8444-555555555555";

const base: ScopeInput = {
  scope_type: "user",
  team_id: null,
  branch_id: null,
  can_view_all_data: false,
  can_edit_team_members: false,
  can_override_permissions: false,
  can_see_earnings: false,
};
const owner = { userId: "o1", role: "owner" };
const gm = { userId: "g1", role: "gm" };
const advisor = { userId: "a1", role: "advisor" };

describe("canChangeScope", () => {
  it("yalnız owner/gm düzenler", () => {
    expect(canChangeScope({ userId: "b1", role: "branch_manager" }, advisor, base).ok).toBe(false);
    expect(canChangeScope(gm, advisor, base).ok).toBe(true);
  });

  it("kendini yükseltme yasağı: kendi kapsamını değiştiremez", () => {
    const r = canChangeScope(gm, { userId: "g1", role: "gm" }, { ...base, scope_type: "office" });
    expect(r.ok).toBe(false);
  });

  it("ofis sahibinin kapsamını yalnız ofis sahibi değiştirir; owner/gm office altına düşürülemez", () => {
    expect(canChangeScope(gm, owner, { ...base, scope_type: "office" }).ok).toBe(false);
    expect(canChangeScope(owner, gm, { ...base, scope_type: "user" }).ok).toBe(false);
    expect(canChangeScope(owner, gm, { ...base, scope_type: "office" }).ok).toBe(true);
  });

  it("platform atanmaz; team/branch bağlam ister", () => {
    expect(canChangeScope(gm, advisor, { ...base, scope_type: "platform" }).ok).toBe(false);
    expect(canChangeScope(gm, advisor, { ...base, scope_type: "team" }).ok).toBe(false);
    expect(canChangeScope(gm, advisor, { ...base, scope_type: "team", team_id: UUID }).ok).toBe(true);
    expect(canChangeScope(gm, advisor, { ...base, scope_type: "branch" }).ok).toBe(false);
    expect(canChangeScope(gm, advisor, { ...base, scope_type: "branch", branch_id: UUID }).ok).toBe(true);
  });

  it("can_view_all_data yalnız office ile; can_override_permissions yalnız owner/gm rolüne", () => {
    expect(canChangeScope(gm, advisor, { ...base, can_view_all_data: true }).ok).toBe(false);
    expect(canChangeScope(gm, advisor, { ...base, scope_type: "office", can_view_all_data: true }).ok).toBe(true);
    expect(canChangeScope(gm, advisor, { ...base, can_override_permissions: true }).ok).toBe(false);
  });

  it("normalize: kapsam dışı bağlam alanları temizlenir", () => {
    expect(normalizeScopeInput({ ...base, scope_type: "user", team_id: UUID, branch_id: UUID })).toMatchObject({ team_id: null, branch_id: null });
    expect(normalizeScopeInput({ ...base, scope_type: "team", team_id: UUID, branch_id: UUID })).toMatchObject({ team_id: UUID, branch_id: null });
  });

  it("isCustomScope rol varsayılanından sapmayı işaretler", () => {
    expect(isCustomScope("advisor", { scope_type: "user" })).toBe(false);
    expect(isCustomScope("advisor", { scope_type: "team" })).toBe(true);
  });
});

describe("canCreateOverride", () => {
  const ok = { resource_type: "demand" as const, resource_id: UUID, allowed: true, reason: "Müdür geçici atama", expires_at: defaultOverrideExpiry(NOW) };

  it("gerekçe zorunlu, kaynak uuid, kendine/ofis sahibine yazılamaz", () => {
    expect(canCreateOverride(gm, advisor, ok, NOW).ok).toBe(true);
    expect(canCreateOverride(gm, advisor, { ...ok, reason: "kısa" }, NOW).ok).toBe(false);
    expect(canCreateOverride(gm, advisor, { ...ok, resource_id: "abc" }, NOW).ok).toBe(false);
    expect(canCreateOverride(gm, { userId: "g1", role: "gm" }, ok, NOW).ok).toBe(false);
    expect(canCreateOverride(owner, owner, ok, NOW).ok).toBe(false);
    expect(canCreateOverride(gm, owner, ok, NOW).ok).toBe(false);
    expect(canCreateOverride(advisor, { userId: "a2", role: "advisor" }, ok, NOW).ok).toBe(false);
  });

  it("izin süresiz olamaz, yasak süresiz olabilir; geçmiş/aşırı uzak tarih reddedilir", () => {
    expect(canCreateOverride(gm, advisor, { ...ok, expires_at: null }, NOW).ok).toBe(false);
    expect(canCreateOverride(gm, advisor, { ...ok, allowed: false, expires_at: null }, NOW).ok).toBe(true);
    expect(canCreateOverride(gm, advisor, { ...ok, expires_at: new Date(NOW - 1000).toISOString() }, NOW).ok).toBe(false);
    expect(canCreateOverride(gm, advisor, { ...ok, expires_at: new Date(NOW + 400 * 86_400_000).toISOString() }, NOW).ok).toBe(false);
    expect(canCreateOverride(gm, advisor, { ...ok, expires_at: "bozuk" }, NOW).ok).toBe(false);
  });

  it("varsayılan bitiş 30 gün; süre dolumu doğru hesaplanır", () => {
    expect(defaultOverrideExpiry(NOW)).toBe(new Date(NOW + 30 * 86_400_000).toISOString());
    expect(isOverrideExpired(new Date(NOW - 1).toISOString(), NOW)).toBe(true);
    expect(isOverrideExpired(new Date(NOW + 1).toISOString(), NOW)).toBe(false);
    expect(isOverrideExpired(null, NOW)).toBe(false);
  });
});

describe("canEditPermissionOverride", () => {
  it("kendine yazamaz, ofis sahibine yazılamaz, yalnız owner/gm", () => {
    expect(canEditPermissionOverride(gm, advisor).ok).toBe(true);
    expect(canEditPermissionOverride(gm, { userId: "g1", role: "gm" }).ok).toBe(false);
    expect(canEditPermissionOverride(gm, owner).ok).toBe(false);
    expect(canEditPermissionOverride({ userId: "b1", role: "branch_manager" }, advisor).ok).toBe(false);
  });
});
