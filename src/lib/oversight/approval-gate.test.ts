import { describe, expect, it } from "vitest";
import {
  APPROVAL_PENDING_MESSAGE,
  approvalCovers,
  evaluateApprovalRule,
  requestApprovalIfNeeded,
  type ApprovalGateStore,
  type OpenApprovalRow,
} from "@/lib/oversight/approval-gate";
import { defaultApprovalRules, normalizeApprovalRules, type ApprovalRules } from "@/lib/oversight/settings";

const on = (patch: Partial<ApprovalRules>): ApprovalRules => ({ ...defaultApprovalRules(), ...patch });

describe("evaluateApprovalRule", () => {
  it("varsayılan: hiçbir kural açık değil", () => {
    const d = evaluateApprovalRule(defaultApprovalRules(), "price_drop", { oldPrice: 1000, newPrice: 100 });
    expect(d.required).toBe(false);
  });

  it("fiyat düşürme: eşik altı serbest, eşik ve üstü onay ister", () => {
    const rules = on({ price_drop: { enabled: true, threshold: 15 } });
    expect(evaluateApprovalRule(rules, "price_drop", { oldPrice: 1000, newPrice: 900 }).required).toBe(false);
    const d = evaluateApprovalRule(rules, "price_drop", { oldPrice: 1000, newPrice: 850, title: "Daire" });
    expect(d.required).toBe(true);
    if (d.required) {
      expect(d.kind).toBe("fiyat_degisikligi");
      expect(d.currentValue).toBe(1000);
      expect(d.requestedValue).toBe(850);
      expect(d.title).toContain("Daire");
    }
  });

  it("fiyat artışı ve geçersiz veri onay istemez", () => {
    const rules = on({ price_drop: { enabled: true, threshold: 5 } });
    expect(evaluateApprovalRule(rules, "price_drop", { oldPrice: 100, newPrice: 120 }).required).toBe(false);
    expect(evaluateApprovalRule(rules, "price_drop", { oldPrice: 0, newPrice: 0 }).required).toBe(false);
    expect(evaluateApprovalRule(rules, "price_drop", {}).required).toBe(false);
  });

  it("komisyon indirimi puan farkına bakar", () => {
    const rules = on({ commission_discount: { enabled: true, threshold: 1 } });
    expect(evaluateApprovalRule(rules, "commission_discount", { standardRate: 3, requestedRate: 2.5 }).required).toBe(false);
    const d = evaluateApprovalRule(rules, "commission_discount", { standardRate: 3, requestedRate: 2 });
    expect(d.required).toBe(true);
    if (d.required) expect(d.kind).toBe("komisyon_indirimi");
  });

  it("ilan silme açıkken her zaman, toplu export eşikle", () => {
    const rules = on({ listing_delete: { enabled: true, threshold: 0 }, bulk_export: { enabled: true, threshold: 100 } });
    expect(evaluateApprovalRule(rules, "listing_delete", { entityId: "p1" }).required).toBe(true);
    expect(evaluateApprovalRule(rules, "bulk_export", { rows: 99 }).required).toBe(false);
    expect(evaluateApprovalRule(rules, "bulk_export", { rows: 100, exportEntity: "customers" }).required).toBe(true);
  });
});

describe("normalizeApprovalRules", () => {
  it("bozuk girdide hepsi kapalı; eşik sınırlanır", () => {
    expect(normalizeApprovalRules(null).listing_delete.enabled).toBe(false);
    const r = normalizeApprovalRules({ price_drop: { enabled: true, threshold: 5000 }, bulk_export: { enabled: "evet" } });
    expect(r.price_drop.enabled).toBe(true);
    expect(r.price_drop.threshold).toBe(90);
    expect(r.bulk_export.enabled).toBe(false);
  });
});

function fakeStore(
  over: Partial<{ rules: ApprovalRules; manager: boolean; open: OpenApprovalRow | null; consumed: boolean; consumeOk: boolean }> = {},
) {
  const calls = { created: 0, consumed: 0 };
  const store: ApprovalGateStore = {
    loadRules: async () => over.rules ?? defaultApprovalRules(),
    isApprovalExempt: async () => over.manager ?? false,
    findOpen: async () => over.open ?? null,
    isConsumed: async () => over.consumed ?? false,
    consume: async () => {
      calls.consumed += 1;
      return over.consumeOk ?? true;
    },
    create: async () => {
      calls.created += 1;
      return { id: "new-1" };
    },
  };
  return { store, calls };
}

const RULES = on({ price_drop: { enabled: true, threshold: 10 } });
const BIG = { oldPrice: 1000, newPrice: 500, entityId: "p1" };
const NOW = Date.parse("2026-10-04T12:00:00Z");

describe("requestApprovalIfNeeded", () => {
  it("kural kapalı: hiçbir şey yapmaz", async () => {
    const { store, calls } = fakeStore();
    const r = await requestApprovalIfNeeded("t", "u", "price_drop", BIG, store, NOW);
    expect(r.status).toBe("not_required");
    expect(calls.created).toBe(0);
  });

  it("eşik üstü: talep açar", async () => {
    const { store, calls } = fakeStore({ rules: RULES });
    const r = await requestApprovalIfNeeded("t", "u", "price_drop", BIG, store, NOW);
    expect(r.status).toBe("requested");
    expect(calls.created).toBe(1);
    expect(r.status === "requested" && r.message).toBe(APPROVAL_PENDING_MESSAGE);
  });

  it("bekleme mesaji hata degil durum bilgisi: tek sabit, /app/onaylar yolu icerir", () => {
    expect(APPROVAL_PENDING_MESSAGE).toContain("yönetici onayı bekliyor; talebiniz iletildi");
    expect(APPROVAL_PENDING_MESSAGE).toContain("Onaylanınca aynı işlemi tekrar yapabilirsiniz");
    expect(APPROVAL_PENDING_MESSAGE).toContain("/app/onaylar");
  });

  it("muaf aktör (owner/gm) kendi işleminde beklemez", async () => {
    const { store, calls } = fakeStore({ rules: RULES, manager: true });
    expect((await requestApprovalIfNeeded("t", "u", "price_drop", BIG, store, NOW)).status).toBe("not_required");
    expect(calls.created).toBe(0);
  });

  it("bekleyen talep varsa yenisi açılmaz", async () => {
    const { store, calls } = fakeStore({ rules: RULES, open: { id: "a1", status: "bekliyor", decidedAt: null } });
    const r = await requestApprovalIfNeeded("t", "u", "price_drop", BIG, store, NOW);
    expect(r.status).toBe("pending");
    expect(r.status === "pending" && r.message).toBe(APPROVAL_PENDING_MESSAGE);
    expect(calls.created).toBe(0);
  });

  it("onaylı talep tek kullanımlıktır ve 48 saatte sona erer", async () => {
    const fresh = { id: "a1", status: "onaylandi" as const, decidedAt: "2026-10-04T08:00:00Z", requestedValue: 500, currentValue: 1000 };
    const a = fakeStore({ rules: RULES, open: fresh });
    expect((await requestApprovalIfNeeded("t", "u", "price_drop", BIG, a.store, NOW)).status).toBe("approved");
    expect(a.calls.consumed).toBe(1);

    const used = fakeStore({ rules: RULES, open: fresh, consumed: true });
    expect((await requestApprovalIfNeeded("t", "u", "price_drop", BIG, used.store, NOW)).status).toBe("requested");

    const old = fakeStore({ rules: RULES, open: { ...fresh, decidedAt: "2026-09-30T08:00:00Z" } });
    expect((await requestApprovalIfNeeded("t", "u", "price_drop", BIG, old.store, NOW)).status).toBe("requested");
  });

  it("onay değere bağlıdır: onaylanandan DAHA DERİN fiyat düşüşü onay sayılmaz, yeni talep açılır", async () => {
    const approved = { id: "a1", status: "onaylandi" as const, decidedAt: "2026-10-04T08:00:00Z", requestedValue: 900, currentValue: 1000 };
    // %10 onaylandı (900) -> 1 TL'ye düşürme
    const deep = fakeStore({ rules: RULES, open: approved });
    const r = await requestApprovalIfNeeded("t", "u", "price_drop", { oldPrice: 1000, newPrice: 1, entityId: "p1" }, deep.store, NOW);
    expect(r.status).toBe("requested");
    expect(deep.calls.consumed).toBe(0);
    expect(deep.calls.created).toBe(1);
    // onaylanan değerin kendisi veya daha hafifi serbest
    const same = fakeStore({ rules: RULES, open: approved });
    expect((await requestApprovalIfNeeded("t", "u", "price_drop", { oldPrice: 1000, newPrice: 900, entityId: "p1" }, same.store, NOW)).status).toBe("approved");
  });

  it("export onayı satır sayısına bağlıdır: onaylanandan fazla satır yeni onay ister", async () => {
    const rules = on({ bulk_export: { enabled: true, threshold: 100 } });
    const approved = { id: "a1", status: "onaylandi" as const, decidedAt: "2026-10-04T08:00:00Z", requestedValue: 500, currentValue: 100 };
    const more = fakeStore({ rules, open: approved });
    expect((await requestApprovalIfNeeded("t", "u", "bulk_export", { rows: 600, exportEntity: "musteriler", channel: "quick" }, more.store, NOW)).status).toBe("requested");
    const fewer = fakeStore({ rules, open: approved });
    expect((await requestApprovalIfNeeded("t", "u", "bulk_export", { rows: 400, exportEntity: "musteriler", channel: "quick" }, fewer.store, NOW)).status).toBe("approved");
  });

  it("parmak izi kanalı ayırır: hızlı export onayı tam akışta kullanılamaz", () => {
    const rules = on({ bulk_export: { enabled: true, threshold: 100 } });
    const quick = evaluateApprovalRule(rules, "bulk_export", { rows: 500, exportEntity: "musteriler", channel: "quick" });
    const full = evaluateApprovalRule(rules, "bulk_export", { rows: 500, exportEntity: "musteriler", channel: "full" });
    expect(quick.required && full.required).toBe(true);
    if (quick.required && full.required) {
      expect(quick.fingerprint).not.toBe(full.fingerprint);
      expect(quick.fingerprint.endsWith(":quick")).toBe(true);
      expect(full.fingerprint.endsWith(":full")).toBe(true);
    }
  });

  it("approvalCovers: ilan silmede değer aranmaz; onaylı değer yoksa kapsamaz", () => {
    const d = { required: true as const, reason: "", kind: "ozel_izin" as const, title: "", currentValue: null, requestedValue: null, fingerprint: "x" };
    expect(approvalCovers("listing_delete", d, {})).toBe(true);
    expect(approvalCovers("price_drop", { ...d, requestedValue: 10 }, { requestedValue: null })).toBe(false);
    expect(approvalCovers("commission_discount", { ...d, requestedValue: 2 }, { requestedValue: 2 })).toBe(true);
    expect(approvalCovers("commission_discount", { ...d, requestedValue: 1 }, { requestedValue: 2 })).toBe(false);
  });

  it("tüketim atomik: yarışı kaybeden / denetim kaydı yazamayan çağrı işlemi REDDEDER", async () => {
    const fresh = { id: "a1", status: "onaylandi" as const, decidedAt: "2026-10-04T08:00:00Z", requestedValue: 500, currentValue: 1000 };
    const lost = fakeStore({ rules: RULES, open: fresh, consumeOk: false });
    const r = await requestApprovalIfNeeded("t", "u", "price_drop", BIG, lost.store, NOW);
    expect(r.status).toBe("error");
    expect(lost.calls.consumed).toBe(1);
  });

  it("kural okuma HATASINDA kapı fail-open olmaz (error); tablo yokluğunu depo çözer", async () => {
    const { store } = fakeStore({ rules: RULES });
    store.loadRules = async () => {
      throw new Error("timeout");
    };
    expect((await requestApprovalIfNeeded("t", "u", "price_drop", BIG, store, NOW)).status).toBe("error");
  });

  it("depo hatasında işlemi sessizce serbest bırakmaz", async () => {
    const { store } = fakeStore({ rules: RULES });
    store.create = async () => {
      throw new Error("db");
    };
    const r = await requestApprovalIfNeeded("t", "u", "price_drop", BIG, store, NOW);
    expect(r.status).toBe("error");
  });
});
