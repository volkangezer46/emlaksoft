import { describe, expect, it } from "vitest";
import { DEFAULT_MATRIX, type AppAction, type AppRole } from "./permissions";
import { mergeEffectivePermissions } from "./permissions-merge";
import { canDecideApproval, mandatoryApprovalCovers, mandatoryApprovalFingerprint, needsMandatoryApproval, splitsFingerprint } from "./approvals";
import { canWriteCommissionLedger, isDealSelfScopeRole, scopeFilterAllowsOwner } from "./permission-data-scope";
import { customerCtaPermissions } from "@/app/app/musteriler/[id]/customer-cta-perms";
import { checkMandatoryApproval, type MandatoryApprovalStore } from "./approval-mandatory";

/**
 * WP2 — danışman kendi anlaşma ve teklifini yürütür (sahip kararı 2026-10-16).
 * Rol başına ETKİN izin matrisi (varsayılan + boş istisna), kapsam kuralı, defter kapısı, onay kararı ve zorunlu onay kapısı.
 */

const ROLES: AppRole[] = ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"];
const eff = (role: AppRole) => mergeEffectivePermissions(role, [], []);
const acts = (role: AppRole, mod: "commissions" | "offers" | "expenses") => [...(eff(role)[mod] ?? [])].sort();

describe("etkin izin matrisi (rol × commissions/offers/expenses)", () => {
  const expected: Record<AppRole, Record<"commissions" | "offers" | "expenses", AppAction[]>> = {
    owner: { commissions: ["create", "delete", "edit", "view"], offers: ["create", "delete", "edit", "view"], expenses: ["create", "delete", "edit", "view"] },
    gm: { commissions: ["create", "delete", "edit", "view"], offers: ["create", "delete", "edit", "view"], expenses: ["create", "delete", "edit", "view"] },
    branch_manager: { commissions: ["create", "edit", "view"], offers: ["create", "edit", "view"], expenses: [] },
    team_lead: { commissions: ["create", "edit", "view"], offers: ["create", "edit", "view"], expenses: [] },
    advisor: { commissions: ["create", "edit", "view"], offers: ["create", "edit", "view"], expenses: [] },
    call_center: { commissions: [], offers: [], expenses: [] },
    accounting: { commissions: ["create", "delete", "edit", "view"], offers: [], expenses: ["create", "edit", "view"] },
    readonly: { commissions: ["view"], offers: [], expenses: [] },
  };
  for (const role of ROLES) {
    it(role, () => {
      expect({ commissions: acts(role, "commissions"), offers: acts(role, "offers"), expenses: acts(role, "expenses") }).toEqual(expected[role]);
    });
  }

  it("ofis rol istisnası (tenant_role_permissions) danışmanın yeni iznini geri alabilir", () => {
    const p = mergeEffectivePermissions("advisor", [{ module: "commissions", action: "create", allowed: false }], []);
    expect(p.commissions).not.toContain("create");
    expect(p.commissions).toContain("edit");
  });

  it("müşteri kartı CTA'ları: danışman 'Anlaşma başlat' ve 'Teklif ver' görür; çağrı merkezi görmez", () => {
    expect(customerCtaPermissions(eff("advisor"))).toMatchObject({ dealsCreate: true, offersCreate: true });
    expect(customerCtaPermissions(eff("team_lead"))).toMatchObject({ dealsCreate: true, offersCreate: true });
    expect(customerCtaPermissions(eff("branch_manager"))).toMatchObject({ dealsCreate: true, offersCreate: true });
    expect(customerCtaPermissions(eff("call_center"))).toMatchObject({ dealsCreate: false, offersCreate: false });
    expect(customerCtaPermissions(eff("readonly"))).toMatchObject({ dealsCreate: false, offersCreate: false });
  });

  it("matris DB kopyası migration'da (20261023040000) üç rol için yazılı", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261023040000_advisor_deals_offers_scope.sql", "utf8");
    expect(sql).toMatch(/values \('advisor'\), \('team_lead'\), \('branch_manager'\)/);
    expect(sql).toMatch(/values \('commissions'\), \('offers'\)/);
    expect(sql).toMatch(/values \('view'\), \('create'\), \('edit'\)/);
    for (const role of ["advisor", "team_lead", "branch_manager"] as const) {
      expect(DEFAULT_MATRIX[role].commissions).toEqual(["view", "create", "edit"]);
      expect(DEFAULT_MATRIX[role].offers).toEqual(["view", "create", "edit"]);
    }
  });
});

describe("kapsam: danışman başka danışmanın anlaşmasına ulaşamaz", () => {
  it("kendi kapsamlı roller", () => {
    for (const r of ["advisor", "team_lead", "call_center", "readonly", "", "bilinmeyen"]) expect(isDealSelfScopeRole(r), r).toBe(true);
    for (const r of ["owner", "gm", "branch_manager", "accounting"]) expect(isDealSelfScopeRole(r), r).toBe(false);
  });

  it("süzgeç: self yalnız kendi kaydı; members üye listesi; none hepsi; atanmamış kayıt yalnız ofis kapsamında", () => {
    const self = { kind: "self" as const, userId: "ali" };
    expect(scopeFilterAllowsOwner(self, ["ali"])).toBe(true);
    expect(scopeFilterAllowsOwner(self, ["ayse"])).toBe(false);
    expect(scopeFilterAllowsOwner(self, [null])).toBe(false);
    expect(scopeFilterAllowsOwner(self, ["ayse", "ali"])).toBe(true); // müşteri: atanan ya da açan
    const team = { kind: "members" as const, ids: ["ali", "veli"] };
    expect(scopeFilterAllowsOwner(team, ["veli"])).toBe(true);
    expect(scopeFilterAllowsOwner(team, ["ayse"])).toBe(false);
    expect(scopeFilterAllowsOwner({ kind: "none" }, [null])).toBe(true);
  });
});

describe("komisyon defteri ve onay kararı", () => {
  it("defter: owner/gm/muhasebe evet; danışman/takım lideri/şube müdürü varsayılanda hayır, commissions:delete istisnasıyla evet", () => {
    for (const r of ["owner", "gm", "accounting"] as AppRole[]) expect(canWriteCommissionLedger(r, eff(r)), r).toBe(true);
    for (const r of ["advisor", "team_lead", "branch_manager", "call_center", "readonly"] as AppRole[]) expect(canWriteCommissionLedger(r, eff(r)), r).toBe(false);
    const bm = mergeEffectivePermissions("branch_manager", [{ module: "commissions", action: "delete", allowed: true }], []);
    expect(canWriteCommissionLedger("branch_manager", bm)).toBe(true);
  });

  it("onay kararı: owner/gm evet; şube müdürü/takım lideri varsayılan edit ile HAYIR, delete istisnasıyla evet; muhasebe/danışman hayır", () => {
    expect(canDecideApproval("owner", eff("owner"))).toBe(true);
    expect(canDecideApproval("gm", eff("gm"))).toBe(true);
    expect(canDecideApproval("branch_manager", eff("branch_manager"))).toBe(false);
    expect(canDecideApproval("team_lead", eff("team_lead"))).toBe(false);
    expect(canDecideApproval("accounting", eff("accounting"))).toBe(false);
    expect(canDecideApproval("advisor", eff("advisor"))).toBe(false);
    const tl = mergeEffectivePermissions("team_lead", [{ module: "commissions", action: "delete", allowed: true }], []);
    expect(canDecideApproval("team_lead", tl)).toBe(true);
  });

  it("zorunlu onay: owner/gm muaf, diğer herkes talep açar", () => {
    expect(needsMandatoryApproval("owner")).toBe(false);
    expect(needsMandatoryApproval("gm")).toBe(false);
    for (const r of ["branch_manager", "team_lead", "advisor", "accounting"]) expect(needsMandatoryApproval(r)).toBe(true);
  });
});

describe("zorunlu onay kapısı (Kazanıldı / paylaşım)", () => {
  const D = "0f8fad5b-d9cb-469f-a165-70867728950e";
  function fakeStore(open: Awaited<ReturnType<MandatoryApprovalStore["findOpen"]>>, consumed = false) {
    const created: string[] = [];
    const store: MandatoryApprovalStore = {
      findOpen: async () => open,
      isConsumed: async () => consumed,
      consume: async () => true,
      create: async (_i, fp) => {
        created.push(fp);
        return { id: "new-req" };
      },
    };
    return { store, created };
  }
  const input = { tenantId: "t", actorId: "ali", role: "advisor", action: "deal_won" as const, entityId: D, entityType: "deal" as const, title: "x", requestedValue: 12_000_000 };
  const NOW = Date.parse("2026-10-16T10:00:00Z");

  it("owner/gm için kapı yok", async () => {
    const { store, created } = fakeStore(null);
    expect((await checkMandatoryApproval({ ...input, role: "gm" }, store, NOW)).status).toBe("not_required");
    expect(created).toEqual([]);
  });

  it("onay yoksa talep açılır (parmak izi kayda bağlı), bekleyen varsa ikinci talep açılmaz", async () => {
    const a = fakeStore(null);
    const r = await checkMandatoryApproval(input, a.store, NOW);
    expect(r.status).toBe("requested");
    expect(a.created).toEqual([`oversight:deal_won:${D}`]);
    const b = fakeStore({ id: "p", status: "bekliyor", decidedAt: null });
    expect((await checkMandatoryApproval(input, b.store, NOW)).status).toBe("pending");
    expect(b.created).toEqual([]);
  });

  it("taze, tüketilmemiş ve AYNI tutarlı onay geçer; tutar değiştiyse, tüketildiyse ya da 48 saati geçtiyse yeni talep", async () => {
    const fresh = { id: "ok", status: "onaylandi" as const, decidedAt: "2026-10-16T08:00:00Z", requestedValue: 12_000_000 };
    expect(await checkMandatoryApproval(input, fakeStore(fresh).store, NOW)).toEqual({ status: "approved", approvalId: "ok" });
    expect((await checkMandatoryApproval({ ...input, requestedValue: 11_000_000 }, fakeStore(fresh).store, NOW)).status).toBe("requested");
    expect((await checkMandatoryApproval(input, fakeStore(fresh, true).store, NOW)).status).toBe("requested");
    const old = { ...fresh, decidedAt: "2026-10-13T08:00:00Z" };
    expect((await checkMandatoryApproval(input, fakeStore(old).store, NOW)).status).toBe("requested");
  });

  it("paylaşım onayı satır özetine bağlı: sıra bağımsız, oran değişince özet değişir", () => {
    const a = splitsFingerprint([{ label: "Ali", rate: 60, party: "staff", profileId: "p1" }, { label: "Ofis", rate: 40, party: "office" }]);
    const b = splitsFingerprint([{ label: "Ofis", rate: 40, party: "office" }, { label: "Ali", rate: 60, party: "staff", profileId: "p1" }]);
    const c = splitsFingerprint([{ label: "Ali", rate: 61, party: "staff", profileId: "p1" }, { label: "Ofis", rate: 39, party: "office" }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(mandatoryApprovalFingerprint("commission_split", D, a)).toBe(`oversight:commission_split:${D}:${a}`);
    expect(mandatoryApprovalCovers("commission_split", {}, {})).toBe(true);
    expect(() => mandatoryApprovalFingerprint("deal_won", "x]%")).toThrow();
  });
});
