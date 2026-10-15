import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXPORT_ROLES_TEXT,
  DEFAULT_OFFICE_POLICY,
  EXPORT_ROLE_IDS,
  OFFICE_EXPORT_ROLES_KEY,
  OFFICE_SECURITY_KEYS,
  exportAllowedForRole,
  normalizeExportRoles,
  policyFromSettingRows,
  policyNeedsProxy,
} from "./policy";
import { getSettingDef } from "@/lib/settings/registry";
import { prepareWrite } from "@/lib/settings/prepare";

const state = vi.hoisted(() => ({ policy: null as unknown }));
vi.mock("./policy-cache", () => ({ readOfficeSecurityPolicyCached: async () => state.policy }));

import { EXPORT_ROLE_BLOCKED_MESSAGE, officeExportBlock } from "./export-gate";

beforeEach(() => {
  state.policy = null;
});

describe("G4 dışa aktarma rolleri (saf)", () => {
  it("varsayılan: tüm roller indirebilir, proxy işi yok (bugünkü davranış)", () => {
    expect(OFFICE_SECURITY_KEYS).toContain(OFFICE_EXPORT_ROLES_KEY);
    expect(DEFAULT_OFFICE_POLICY.exportRoles).toEqual([...EXPORT_ROLE_IDS]);
    expect(policyFromSettingRows([]).exportRoles).toEqual([...EXPORT_ROLE_IDS]);
    expect(policyNeedsProxy(policyFromSettingRows([{ key: OFFICE_EXPORT_ROLES_KEY, value: "owner" }]))).toBe(false);
    for (const role of EXPORT_ROLE_IDS) {
      expect(exportAllowedForRole(null, role)).toBe(true);
      expect(exportAllowedForRole(DEFAULT_OFFICE_POLICY, role)).toBe(true);
    }
  });

  it("liste dışındaki rol indiremez; sahip her zaman indirebilir", () => {
    const p = policyFromSettingRows([{ key: OFFICE_EXPORT_ROLES_KEY, value: "gm,accounting" }]);
    expect(p.exportRoles).toEqual(["owner", "gm", "accounting"]);
    expect(exportAllowedForRole(p, "owner")).toBe(true);
    expect(exportAllowedForRole(p, "gm")).toBe(true);
    expect(exportAllowedForRole(p, "advisor")).toBe(false);
    expect(exportAllowedForRole(p, null)).toBe(false);
    // Boş liste bile sahibi dışarıda bırakmaz.
    expect(normalizeExportRoles("")).toEqual(["owner"]);
    expect(normalizeExportRoles("hacker, advisor")).toEqual(["owner", "advisor"]);
  });

  it("kayıt defteri: varsayılan tüm roller, köprü dışı yazılamaz, sahibi çıkaran/bilinmeyen rol reddedilir", () => {
    const d = getSettingDef(OFFICE_EXPORT_ROLES_KEY)!;
    expect(d.scope).toBe("tenant");
    expect(d.editMode).toBe("bridge");
    expect(d.default).toBe(DEFAULT_EXPORT_ROLES_TEXT);
    expect(prepareWrite({ key: OFFICE_EXPORT_ROLES_KEY, value: "owner", reason: "deneme gerekçe" }).ok).toBe(false);
    expect(prepareWrite({ key: OFFICE_EXPORT_ROLES_KEY, value: "owner,gm", reason: "deneme gerekçe", fromBridge: true }).ok).toBe(true);
    expect(prepareWrite({ key: OFFICE_EXPORT_ROLES_KEY, value: "gm,advisor", reason: "deneme gerekçe", fromBridge: true }).ok).toBe(false);
    expect(prepareWrite({ key: OFFICE_EXPORT_ROLES_KEY, value: "owner,root", reason: "deneme gerekçe", fromBridge: true }).ok).toBe(false);
  });
});

describe("G4 dışa aktarma kapısı (sunucu)", () => {
  it("politika yoksa geçer; listede olmayan rol engellenir", async () => {
    expect(await officeExportBlock("t1", "advisor")).toBeNull();
    state.policy = policyFromSettingRows([{ key: OFFICE_EXPORT_ROLES_KEY, value: "owner,gm" }]);
    expect(await officeExportBlock("t1", "advisor")).toBe(EXPORT_ROLE_BLOCKED_MESSAGE);
    expect(await officeExportBlock("t1", "gm")).toBeNull();
    expect(await officeExportBlock("t1", "owner")).toBeNull();
    expect(await officeExportBlock(null, "advisor")).toBeNull();
  });
});
