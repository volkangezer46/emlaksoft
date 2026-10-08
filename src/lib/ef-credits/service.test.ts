import { beforeEach, describe, expect, it, vi } from "vitest";

type Res = { units: number; state: "reserved" | "committed" | "released"; idem: string; tenant: string };
type Row = {
  id: string; tenant_id: string; user_id: string | null; rapor_id: string; reservation_id: string | null; mahalle_id: number | null;
  ada: string | null; parsel: string | null; tip: string | null; guven_sinifi: string | null; sonuc_durumu: string | null;
  units_charged: number; pdf_charged: boolean; pdf_reservation_id: string | null; created_at: string; expires_at: string | null;
};

const w = vi.hoisted(() => ({
  ready: true,
  walletDown: false,
  commitFail: false,
  balance: 100,
  res: new Map<string, Res>(),
  reports: new Map<string, Row>(),
  commitCalls: 0,
  releaseCalls: 0,
  reserveCalls: 0,
}));
const settings = vi.hoisted(() => ({ values: new Map<string, string | null>(), flag: true, probe: "2026-10-05T09:00:00.000Z" as string | null, configured: true }));
const ef = vi.hoisted(() => ({ degerleme: vi.fn(), rapor: vi.fn(), pdf: vi.fn() }));
const auditCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/activity", () => ({ logActivity: async (i: Record<string, unknown>) => { auditCalls.push(i); return { ok: true }; } }));
vi.mock("@/lib/platform-settings", () => ({ getPlatformSetting: async (k: string) => settings.values.get(k) ?? null }));
vi.mock("@/lib/integrations/emlakfiyati/adapter", () => ({ isEmlakFiyatiConfigured: async () => settings.configured }));
vi.mock("@/lib/integrations/emlakfiyati/ortak", () => ({ isOrtakFlagOn: async () => settings.flag, getOrtakProbeOkAt: async () => settings.probe }));
vi.mock("@/lib/integrations/emlakfiyati/ortak-client", () => ({
  ortakDegerleme: ef.degerleme,
  ortakRapor: ef.rapor,
  ortakRaporPdf: ef.pdf,
}));
vi.mock("./wallet", () => {
  const available = () => w.balance - [...w.res.values()].filter((r) => r.state === "reserved").reduce((s, r) => s + r.units, 0);
  return {
    efCreditReady: async () => w.ready,
    efBalance: async () => (w.ready ? { available: available(), reserved: 0, granted_total: 100, committed_total: 100 - w.balance } : null),
    efReserve: async (p: { tenantId: string; units: number; idem: string }) => {
      w.reserveCalls += 1;
      if (w.walletDown) return null;
      for (const [id, r] of w.res) if (r.idem === p.idem && r.tenant === p.tenantId) return { ok: true, code: "duplicate", reservation_id: id, state: r.state, available: available() };
      if (available() < p.units) return { ok: false, code: "insufficient", available: available() };
      const id = crypto.randomUUID();
      w.res.set(id, { units: p.units, state: "reserved", idem: p.idem, tenant: p.tenantId });
      return { ok: true, code: "ok", reservation_id: id, state: "reserved", available: available() };
    },
    efCommit: async (_t: string, id: string) => {
      w.commitCalls += 1;
      if (w.commitFail) return null;
      const r = w.res.get(id);
      if (!r) return { ok: false, state: "unknown", already: false };
      if (r.state === "committed") return { ok: true, state: "committed", already: true };
      if (r.state !== "reserved") return { ok: false, state: r.state, already: false };
      r.state = "committed";
      w.balance -= r.units;
      return { ok: true, state: "committed", already: false };
    },
    efRelease: async (_t: string, id: string) => {
      w.releaseCalls += 1;
      const r = w.res.get(id);
      if (!r) return { ok: false, state: "unknown", already: false };
      if (r.state === "released") return { ok: true, state: "released", already: true };
      if (r.state !== "reserved") return { ok: false, state: r.state, already: false };
      r.state = "released";
      return { ok: true, state: "released", already: false };
    },
    insertEfReport: async (r: { tenantId: string; userId: string; raporId: string; reservationId: string | null; mahalleId: number; ada: string; parsel: string; tip: string | null; guvenSinifi: string | null; unitsCharged: number; expiresAt: string | null }) => {
      const key = `${r.tenantId}:${r.raporId}`;
      if (!w.reports.has(key)) {
        w.reports.set(key, {
          id: crypto.randomUUID(), tenant_id: r.tenantId, user_id: r.userId, rapor_id: r.raporId, reservation_id: r.reservationId, mahalle_id: r.mahalleId,
          ada: r.ada, parsel: r.parsel, tip: r.tip, guven_sinifi: r.guvenSinifi, sonuc_durumu: "deger", units_charged: r.unitsCharged, pdf_charged: false,
          pdf_reservation_id: null, created_at: "2026-10-05T10:00:00.000Z", expires_at: r.expiresAt,
        });
      }
      return true;
    },
    getEfReport: async (tenantId: string, raporId: string) => w.reports.get(`${tenantId}:${raporId}`) ?? null,
    listEfReports: async (tenantId: string) => [...w.reports.values()].filter((r) => r.tenant_id === tenantId),
    markEfPdfCharged: async (tenantId: string, raporId: string, resId: string) => {
      const row = w.reports.get(`${tenantId}:${raporId}`);
      if (row && !row.pdf_charged) {
        row.pdf_charged = true;
        row.pdf_reservation_id = resId;
      }
      return true;
    },
  };
});

import { EF_TARIFF_SETTING_KEY, efIdempotencyKey } from "./config";
import { getEfFeatureState, getOwnedReport, getReportDetail, getReportPdf, listTenantReports, runParcelValuation } from "./service";

const T1 = "9d1c7a52-6b3e-4f08-a1d4-2e5f6a7b8c90";
const T2 = "7e1c7a52-6b3e-4f08-a1d4-2e5f6a7b8c91";
const U = "3f2b8a9e-1c4d-4e6f-8a7b-9c0d1e2f3a4b";
const RID = "3f0c2d9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const INPUT = { mahalleId: 162, ada: "101", parsel: "1", tip: "arsa" as const };
const FUTURE = "2099-01-01T00:00:00.000Z";

const okValue = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  requestId: "req-1",
  replayed: false,
  attempts: 1,
  data: { durum: "deger", ucretlendirilir: true, raporId: RID, expiresAt: FUTURE, gecerlilikGun: 30, tip: "arsa", parsel: null, guvenSinifi: "orta", dusukGuven: false, guvenSunumu: null, tahmin: null, fiyatYayin: null, emsaller: null, konutOzellikleri: null, ...over },
});
const fail = (kind: string, code: string | null = null) => ({ ok: false as const, kind, code, requestId: "req-err", retryAfterSec: null, attempts: 1 });

function seedReport(tenant = T1, over: Partial<Row> = {}) {
  w.reports.set(`${tenant}:${RID}`, {
    id: "row-1", tenant_id: tenant, user_id: U, rapor_id: RID, reservation_id: null, mahalle_id: 162, ada: "101", parsel: "1", tip: "arsa",
    guven_sinifi: "orta", sonuc_durumu: "deger", units_charged: 5, pdf_charged: false, pdf_reservation_id: null,
    created_at: "2026-10-05T10:00:00.000Z", expires_at: FUTURE, ...over,
  });
}

describe("EF kontör servisi", () => {
  beforeEach(() => {
    w.ready = true; w.walletDown = false; w.commitFail = false; w.balance = 100;
    w.res.clear(); w.reports.clear(); w.commitCalls = 0; w.releaseCalls = 0; w.reserveCalls = 0;
    settings.values.clear(); settings.values.set(EF_TARIFF_SETTING_KEY, JSON.stringify({ valuationArsa: 5, valuationKonut: 5, pdfFirst: 2, reportDetail: 0 })); settings.flag = true; settings.probe = "2026-10-05T09:00:00.000Z"; settings.configured = true;
    ef.degerleme.mockReset(); ef.rapor.mockReset(); ef.pdf.mockReset();
    auditCalls.length = 0;
  });

  describe("runParcelValuation", () => {
    it("deger + ucretlendirilir:true → rezerve, Idempotency-Key rezerv kimliğinden, TEK commit, ef_reports satırı, kişisel verisiz denetim", async () => {
      ef.degerleme.mockResolvedValue(okValue());
      const r = await runParcelValuation({ tenantId: T1, userId: U, input: INPUT });
      expect(r).toMatchObject({ status: "ok", raporId: RID, unitsCharged: 5, replayed: false, settlementPending: false });
      const [resId] = [...w.res.keys()];
      expect(ef.degerleme).toHaveBeenCalledTimes(1);
      expect(ef.degerleme.mock.calls[0]![0].idempotencyKey).toBe(efIdempotencyKey(resId!));
      expect(w.commitCalls).toBe(1);
      expect(w.balance).toBe(95);
      const row = w.reports.get(`${T1}:${RID}`)!;
      expect(row).toMatchObject({ units_charged: 5, reservation_id: resId, tip: "arsa", guven_sinifi: "orta" });
      const a = auditCalls[0]!;
      expect(a).toMatchObject({ tenantId: T1, actorId: U, action: "ef.valuation", entityId: RID });
      expect(a.newValue).toMatchObject({ item: "valuation_arsa", units: 5, units_charged: 5, request_id: "req-1" });
      expect(JSON.stringify(a)).not.toMatch(/"ada"|"parsel"|101/);
    });

    it("konut tarifesi uygulanır", async () => {
      settings.values.set(EF_TARIFF_SETTING_KEY, JSON.stringify({ valuationArsa: 5, valuationKonut: 8, pdfFirst: 3, reportDetail: 0 }));
      ef.degerleme.mockResolvedValue(okValue({ tip: "konut" }));
      const r = await runParcelValuation({ tenantId: T1, userId: U, input: { mahalleId: 1, ada: "1", parsel: "1", tip: "konut", konut: { konutM2: 90 } } });
      expect(r).toMatchObject({ status: "ok", unitsCharged: 8 });
      expect(w.balance).toBe(92);
    });

    it("ayar yoksa varsayılan tarife (1 kontör = 1 TL): konut 700, arsa 850; ilk PDF rapora dahil (0)", async () => {
      settings.values.clear();
      w.balance = 3000;
      ef.degerleme.mockResolvedValue(okValue({ tip: "konut" }));
      const konut = await runParcelValuation({ tenantId: T1, userId: U, input: { mahalleId: 1, ada: "1", parsel: "1", tip: "konut", konut: { konutM2: 90 } } });
      expect(konut).toMatchObject({ status: "ok", unitsCharged: 700 });
      expect(w.balance).toBe(2300);
      ef.degerleme.mockResolvedValue(okValue({ raporId: "11111111-1111-4111-8111-111111111111" }));
      const arsa = await runParcelValuation({ tenantId: T1, userId: U, input: INPUT });
      expect(arsa).toMatchObject({ status: "ok", unitsCharged: 850 });
      expect(w.balance).toBe(1450);
    });

    it("tarife 0 ise rezerve AÇILMAZ ve commit yok", async () => {
      settings.values.set(EF_TARIFF_SETTING_KEY, JSON.stringify({ valuationArsa: 0, valuationKonut: 0, pdfFirst: 0, reportDetail: 0 }));
      ef.degerleme.mockResolvedValue(okValue());
      const r = await runParcelValuation({ tenantId: T1, userId: U, input: INPUT });
      expect(r).toMatchObject({ status: "ok", unitsCharged: 0 });
      expect(w.reserveCalls).toBe(0);
      expect(w.commitCalls).toBe(0);
      expect(ef.degerleme.mock.calls[0]![0].idempotencyKey).toMatch(/^es-[0-9a-f-]{36}$/);
      expect(w.reports.has(`${T1}:${RID}`)).toBe(true);
    });

    it("yetersiz → İADE, rapor satırı yok, 'ucretlendirilmedi'", async () => {
      ef.degerleme.mockResolvedValue({ ok: true, requestId: "req-2", replayed: false, attempts: 1, data: { durum: "yetersiz", ucretlendirilir: false, mesaj: "Veri yok", nedenler: ["deger_yok"] } });
      const r = await runParcelValuation({ tenantId: T1, userId: U, input: INPUT });
      expect(r).toMatchObject({ status: "insufficient", refunded: true, result: { nedenler: ["deger_yok"] } });
      expect(w.commitCalls).toBe(0);
      expect(w.releaseCalls).toBe(1);
      expect(w.balance).toBe(100);
      expect([...w.res.values()][0]!.state).toBe("released");
      expect(w.reports.size).toBe(0);
    });

    it("deger ama ucretlendirilir:false → İADE; rapor kaydedilir (units 0)", async () => {
      ef.degerleme.mockResolvedValue(okValue({ ucretlendirilir: false }));
      const r = await runParcelValuation({ tenantId: T1, userId: U, input: INPUT });
      expect(r).toMatchObject({ status: "ok", unitsCharged: 0 });
      expect(w.commitCalls).toBe(0);
      expect(w.balance).toBe(100);
      expect(w.reports.get(`${T1}:${RID}`)!.units_charged).toBe(0);
    });

    it.each([
      ["rate_limited", null],
      ["unavailable", "kademeli_kuyruk"],
      ["timeout", null],
      ["network", null],
      ["server", null],
      ["invalid_input", "gecersiz_girdi"],
      ["forbidden", "kapsam_yok"],
      ["auth", null],
      ["invalid_response", null],
    ] as const)("hata/429/zaman aşımı (%s) → İADE, kontör düşmez, kullanıcı mesajı anahtar/URL içermez", async (kind, code) => {
      ef.degerleme.mockResolvedValue(fail(kind, code));
      const r = await runParcelValuation({ tenantId: T1, userId: U, input: INPUT });
      expect(r).toMatchObject({ status: "error", kind, refunded: true, requestId: "req-err" });
      if (r.status !== "error") throw new Error("beklenmeyen");
      expect(r.message).toMatch(/düşülmedi|değil|kullanılamıyor|yoğun/);
      expect(r.message).not.toMatch(/ek_live|emlakfiyati|https?:/i);
      expect(w.commitCalls).toBe(0);
      expect(w.balance).toBe(100);
      expect([...w.res.values()].every((x) => x.state === "released")).toBe(true);
      expect(w.reports.size).toBe(0);
    });

    it("Idempotency-Replayed: true (zaman aşımı sonrası aynı anahtarla yeniden sorulan işlem) → ikinci commit/çift düşüm YOK", async () => {
      ef.degerleme.mockResolvedValue({ ...okValue(), replayed: true, attempts: 2 });
      const r = await runParcelValuation({ tenantId: T1, userId: U, input: INPUT });
      expect(r).toMatchObject({ status: "ok", replayed: true, unitsCharged: 5 });
      expect(w.commitCalls).toBe(1);
      expect(w.balance).toBe(95);
      expect(w.reports.size).toBe(1);
      // Aynı rezervin yeniden kesinleştirilmesi idempotenttir (already): bakiye değişmez, rapor satırı ikilenmez.
      const [resId] = [...w.res.keys()];
      const { efCommit } = await import("./wallet");
      expect(await efCommit(T1, resId!, {})).toMatchObject({ already: true });
      expect(w.balance).toBe(95);
    });

    it("yetersiz kontör → sorgu YAPILMAZ", async () => {
      w.balance = 3;
      const r = await runParcelValuation({ tenantId: T1, userId: U, input: INPUT });
      expect(r).toEqual({ status: "no_credit", available: 3, needed: 5 });
      expect(ef.degerleme).not.toHaveBeenCalled();
    });

    it("FAIL-CLOSED: cüzdan yazılamazsa sorgu YAPILMAZ", async () => {
      w.walletDown = true;
      const r = await runParcelValuation({ tenantId: T1, userId: U, input: INPUT });
      expect(r).toMatchObject({ status: "error", code: "wallet" });
      expect(ef.degerleme).not.toHaveBeenCalled();
      expect(w.balance).toBe(100);
    });

    it("commit yazılamazsa rapor yine verilir ve kaydedilir; settlementPending", async () => {
      ef.degerleme.mockResolvedValue(okValue());
      w.commitFail = true;
      const r = await runParcelValuation({ tenantId: T1, userId: U, input: INPUT });
      expect(r).toMatchObject({ status: "ok", unitsCharged: 0, settlementPending: true });
      expect(w.reports.get(`${T1}:${RID}`)!.units_charged).toBe(0);
    });

    it("geçersiz girdi: ne rezerve ne sorgu", async () => {
      const r = await runParcelValuation({ tenantId: T1, userId: U, input: { ...INPUT, ada: "abc" } });
      expect(r.status).toBe("invalid");
      expect(w.reserveCalls).toBe(0);
      expect(ef.degerleme).not.toHaveBeenCalled();
    });

    it.each([
      ["bayrak kapalı", () => { settings.flag = false; }, /etkinleştirilmemiş/],
      ["yoklama yok", () => { settings.probe = null; }, /yoklaması/],
      ["kontör bakiyesi hazır değil", () => { w.ready = false; }, /Kontör bakiyesi/],
      ["anahtar yok", () => { settings.configured = false; }, /anahtarı/],
    ] as const)("etkin değil (%s): açık eksik ön koşul, sorgu/rezerve yok", async (_n, setup, re) => {
      setup();
      const r = await runParcelValuation({ tenantId: T1, userId: U, input: INPUT });
      expect(r.status).toBe("disabled");
      if (r.status !== "disabled") throw new Error("beklenmeyen");
      // Ofis kullanıcısı yalnız tek cümle görür; teknik ayrıntı `details`'te (yalnız /admin/sistem).
      expect(r.message).toBe("Bu özellik henüz etkinleştirilmedi.");
      expect(r.missing).toEqual([]);
      expect((await getEfFeatureState(T1)).details.join(" ")).toMatch(re);
      expect(w.reserveCalls).toBe(0);
      expect(ef.degerleme).not.toHaveBeenCalled();
    });
  });

  describe("tenant sahipliği", () => {
    it("rapor_id ERİŞİM ANAHTARIDIR: başka tenant'ın raporu 404 (not_found); sorgu yapılmaz", async () => {
      seedReport(T1);
      expect(await getOwnedReport(T2, RID)).toEqual({ ok: false, status: "not_found" });
      expect(await getOwnedReport(T1, "../x")).toEqual({ ok: false, status: "not_found" });
      expect(await getReportPdf({ tenantId: T2, userId: U, raporId: RID })).toMatchObject({ status: "not_found" });
      expect(await getReportDetail({ tenantId: T2, userId: U, raporId: RID })).toMatchObject({ status: "not_found" });
      expect(ef.pdf).not.toHaveBeenCalled();
      expect(ef.rapor).not.toHaveBeenCalled();
      expect(w.reserveCalls).toBe(0);
    });

    it("görünürlük: danışman başkasının raporunu göremez (404, sorgu/rezerve yok); sahibi ve owner/gm görür", async () => {
      const OTHER = "5a5a5a5a-1c4d-4e6f-8a7b-9c0d1e2f3a4b";
      seedReport(T1); // sahibi U
      expect(await getOwnedReport(T1, RID, { userId: OTHER, role: "advisor" })).toEqual({ ok: false, status: "not_found" });
      expect((await getOwnedReport(T1, RID, { userId: U, role: "advisor" })).ok).toBe(true);
      expect((await getOwnedReport(T1, RID, { userId: OTHER, role: "owner" })).ok).toBe(true);
      expect((await getOwnedReport(T1, RID, { userId: OTHER, role: "gm" })).ok).toBe(true);
      expect(await getReportPdf({ tenantId: T1, userId: OTHER, role: "advisor", raporId: RID })).toMatchObject({ status: "not_found" });
      expect(await getReportDetail({ tenantId: T1, userId: OTHER, role: "advisor", raporId: RID })).toMatchObject({ status: "not_found" });
      expect(ef.pdf).not.toHaveBeenCalled();
      expect(ef.rapor).not.toHaveBeenCalled();
      expect(w.reserveCalls).toBe(0);
    });

    it("listTenantReports: danışman yalnız kendi raporlarını, owner/gm ofisinkileri görür", async () => {
      const OTHER = "5a5a5a5a-1c4d-4e6f-8a7b-9c0d1e2f3a4b";
      seedReport(T1);
      w.reports.set(`${T1}:other`, { ...w.reports.get(`${T1}:${RID}`)!, user_id: OTHER, rapor_id: "other" });
      expect((await listTenantReports(T1, 30, { userId: U, role: "advisor" }))!.map((r) => r.user_id)).toEqual([U]);
      expect((await listTenantReports(T1, 30, { userId: U, role: "owner" }))!).toHaveLength(2);
      expect((await listTenantReports(T1, 30, { userId: U, role: "readonly" }))!.map((r) => r.user_id)).toEqual([U]);
    });

    it("süresi dolan rapor: expired", async () => {
      seedReport(T1, { expires_at: "2020-01-01T00:00:00.000Z" });
      expect(await getOwnedReport(T1, RID)).toEqual({ ok: false, status: "expired" });
      expect(await getReportPdf({ tenantId: T1, userId: U, raporId: RID })).toMatchObject({ status: "expired" });
    });
  });

  describe("PDF", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    it("ilk indirme ücretli (tek ücretlendirme), sonraki indirmeler ÜCRETSİZ", async () => {
      seedReport(T1);
      ef.pdf.mockResolvedValue({ ok: true, requestId: "req-pdf", replayed: false, attempts: 1, data: { bytes } });
      const first = await getReportPdf({ tenantId: T1, userId: U, raporId: RID });
      expect(first).toMatchObject({ status: "ok", unitsCharged: 2, requestId: "req-pdf" });
      expect(w.balance).toBe(98);
      expect(w.reports.get(`${T1}:${RID}`)!.pdf_charged).toBe(true);
      const second = await getReportPdf({ tenantId: T1, userId: U, raporId: RID });
      expect(second).toMatchObject({ status: "ok", unitsCharged: 0 });
      expect(w.reserveCalls).toBe(1);
      expect(w.commitCalls).toBe(1);
      expect(w.balance).toBe(98);
      expect(ef.pdf).toHaveBeenCalledTimes(2); // önbellek yok
    });

    it("PDF 200 değilse İADE ve pdf_charged işaretlenmez", async () => {
      seedReport(T1);
      ef.pdf.mockResolvedValue(fail("pdf_failed", "pdf_uretilemedi"));
      const r = await getReportPdf({ tenantId: T1, userId: U, raporId: RID });
      expect(r).toMatchObject({ status: "error", kind: "pdf_failed" });
      expect(w.balance).toBe(100);
      expect([...w.res.values()][0]!.state).toBe("released");
      expect(w.reports.get(`${T1}:${RID}`)!.pdf_charged).toBe(false);
    });

    it("yetersiz kontör: PDF çağrılmaz; tarife 0: ücretsiz", async () => {
      seedReport(T1);
      w.balance = 1;
      expect(await getReportPdf({ tenantId: T1, userId: U, raporId: RID })).toMatchObject({ status: "no_credit", needed: 2 });
      expect(ef.pdf).not.toHaveBeenCalled();
      settings.values.set(EF_TARIFF_SETTING_KEY, JSON.stringify({ valuationArsa: 5, valuationKonut: 5, pdfFirst: 0, reportDetail: 0 }));
      ef.pdf.mockResolvedValue({ ok: true, requestId: "r", replayed: false, attempts: 1, data: { bytes } });
      expect(await getReportPdf({ tenantId: T1, userId: U, raporId: RID })).toMatchObject({ status: "ok", unitsCharged: 0 });
    });

    it("aynı raporun eşzamanlı ilk-PDF indirmesi: ikincisi 'busy' (çift ücretlendirme yok)", async () => {
      seedReport(T1);
      let release: () => void = () => undefined;
      ef.pdf.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ ok: true, requestId: "r", replayed: false, attempts: 1, data: { bytes } }); }));
      const a = getReportPdf({ tenantId: T1, userId: U, raporId: RID });
      await new Promise((r) => setTimeout(r, 0));
      const b = await getReportPdf({ tenantId: T1, userId: U, raporId: RID });
      expect(b).toMatchObject({ status: "busy" });
      release();
      expect(await a).toMatchObject({ status: "ok", unitsCharged: 2 });
      expect(w.balance).toBe(98);
    });
  });

  describe("rapor detayı", () => {
    it("varsayılan tarife 0: kontör DÜŞMEZ, rezerve açılmaz", async () => {
      seedReport(T1);
      ef.rapor.mockResolvedValue({ ok: true, requestId: "r1", replayed: false, attempts: 1, data: { durum: "deger", ucretlendirilir: true, raporId: RID } });
      const r = await getReportDetail({ tenantId: T1, userId: U, raporId: RID });
      expect(r).toMatchObject({ status: "ok", unitsCharged: 0 });
      expect(w.reserveCalls).toBe(0);
    });

    it("tarife > 0: rezerve → commit; hata → iade", async () => {
      seedReport(T1);
      settings.values.set(EF_TARIFF_SETTING_KEY, JSON.stringify({ valuationArsa: 5, valuationKonut: 5, pdfFirst: 3, reportDetail: 1 }));
      ef.rapor.mockResolvedValueOnce({ ok: true, requestId: "r1", replayed: false, attempts: 1, data: { durum: "deger", ucretlendirilir: true, raporId: RID } });
      expect(await getReportDetail({ tenantId: T1, userId: U, raporId: RID })).toMatchObject({ status: "ok", unitsCharged: 1 });
      expect(w.balance).toBe(99);
      ef.rapor.mockResolvedValueOnce(fail("not_found", "rapor_yok"));
      expect(await getReportDetail({ tenantId: T1, userId: U, raporId: RID })).toMatchObject({ status: "error", kind: "not_found" });
      expect(w.balance).toBe(99);
    });
  });
});
