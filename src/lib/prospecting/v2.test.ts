import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateAuthorization, parseAuthorizationNote } from "./authorization";
import { FSBO_ALLOWED_ACTIONS, fsboTaskLink } from "./automation-source";
import { buildCallScript } from "./script";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("yetki / EİDS durumu", () => {
  it("durum notundan tarih ve süreyi okur", () => {
    expect(parseAuthorizationNote("Yetkilendirme sözleşmesi: 05.10.2026, 3 ay.")).toEqual({ signedOn: "2026-10-05", months: 3 });
    expect(parseAuthorizationNote("Elle eklendi.")).toBeNull();
    expect(parseAuthorizationNote(null)).toBeNull();
  });

  it("bitişi ve kalan günü hesaplar; 3 ayı aşan süre uyarılır", () => {
    const a = evaluateAuthorization("Yetkilendirme sözleşmesi: 05.10.2026, 3 ay.", "2026-10-12");
    expect(a).toMatchObject({ endsOn: "2027-01-05", daysLeft: 85, state: "active", overLegalMax: false });
    expect(evaluateAuthorization("Yetkilendirme sözleşmesi: 31.01.2026, 1 ay.", "2026-03-05")).toMatchObject({ endsOn: "2026-02-28", state: "expired" });
    expect(evaluateAuthorization("Yetkilendirme sözleşmesi: 01.10.2026, 6 ay.", "2026-10-12")?.overLegalMax).toBe(true);
    expect(evaluateAuthorization("Yetkilendirme sözleşmesi: 05.10.2026, 3 ay.", "2027-01-01")?.state).toBe("expiring");
  });
});

describe("script: bölgedeki alıcı talebi cümlesi", () => {
  const base = { advisorName: "A", officeName: "O", licenseNo: null, districtName: "Kadıköy", rooms: "3+1", portalLabel: "sahibinden" };
  it("sayı varsa cümle çıkar, yoksa çıkmaz", () => {
    expect(JSON.stringify(buildCallScript({ ...base, activeBuyerDemands: 7 }))).toContain("7 aktif alıcı talebimiz");
    expect(JSON.stringify(buildCallScript({ ...base, activeBuyerDemands: null }))).not.toContain("aktif alıcı");
    expect(JSON.stringify(buildCallScript({ ...base, activeBuyerDemands: 0 }))).not.toContain("aktif alıcı");
  });
});

describe("otomasyon: FSBO yalnız görev / atama / bildirim", () => {
  it("mesaj, etiket ve durum eylemleri kapalı", () => {
    expect([...FSBO_ALLOWED_ACTIONS].sort()).toEqual(["assign_to_staff", "create_task", "notify_manager", "send_notification"]);
    for (const t of ["send_sms", "send_whatsapp", "add_tag", "change_status"]) expect(FSBO_ALLOWED_ACTIONS.has(t)).toBe(false);
  });
  it("motor FSBO payload'ında kapalı eylemleri atlar ve görev bağını yardımcıdan alır", () => {
    const engine = read("src/lib/automation-engine.ts");
    expect(engine).toContain('payload.entityType === "fsbo_lead" && !FSBO_ALLOWED_ACTIONS.has(type)');
    expect(fsboTaskLink("fsbo_lead", "x")).toEqual({ fsbo_lead_id: "x" });
    expect(fsboTaskLink("customer", "x")).toEqual({});
  });
  it("sunucu eylemi FSBO tetikleyicilerinde mesaj eylemlerini reddeder", () => {
    expect(read("src/app/actions/automations.ts")).toContain('triggerType.includes("fsbo")');
  });
});

describe("anında içgörü kapatma ve realtime", () => {
  it("arama / aranmasın / durum / dönüşüm kapatma RPC'sini çağırır", () => {
    const actions = read("src/app/actions/prospecting.ts");
    expect(actions.match(/closeFsboInsightAfterContact\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(read("src/lib/prospecting/convert.ts")).toContain("closeFsboInsightAfterContact(lead.id)");
    expect(read("src/lib/insights/store.ts")).toContain('rpc("insight_close_fsbo_lead"');
  });
  it("migration dar RPC: yalnız valid_until yazar, kiracı ve ilan kontrollü", () => {
    const sql = read("supabase/migrations/20261012002500_fsbo_realtime.sql");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set valid_until = pg_catalog.now()");
    expect(sql).toContain("l.tenant_id = v_tenant");
    expect(sql).toContain("alter publication supabase_realtime add table public.fsbo_leads");
    expect(sql).not.toMatch(/set\s+state\b/i);
  });
});
