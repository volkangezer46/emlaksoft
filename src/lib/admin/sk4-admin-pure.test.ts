import { describe, expect, it } from "vitest";
import { readinessSignals, type OpsReadiness } from "@/lib/admin/ops-readiness-model";
import { systemStatusOf } from "@/lib/admin/system-status";
import { buildAttentionQueue, type AttentionInput } from "@/lib/admin/dashboard-layout";
import { resolvePlanStatusAmount, nextPlanOf } from "@/lib/billing/plan-status-amount";
import { memberSubtitle, tenantSubtitle, ticketNoQuery, ticketSubtitle } from "@/lib/admin/search-format";
import { cronDetailView, humanizeKey } from "@/lib/admin/cron-detail";
import { HUB_META, cardTone, isMissingRequired, isRequiredHub } from "@/lib/admin/integration-hub/model";
import { templateBadge } from "@/lib/email/template-status";
import { isFreshSnapshot, STATUS_MAX_AGE_MS } from "@/lib/status-page/cache";
import { channelClosedMessage, submitApplication } from "@/lib/compliance/platform-kvkk-service";

/**
 * SK4 (REALTIME-2) saf modelleri: operasyon hazırlık sinyalleri (B114/B115/B117), abonelik tutar önizlemesi (B118),
 * komut paleti biçimleri (B120/B192), cron özeti (B192), zorunlu entegrasyon (B117), /durum yaş sınırı (B017).
 */

const READY: OpsReadiness = {
  channels: 1,
  criticalLast24h: 0,
  unnotifiedCritical24h: 0,
  backup: { present: true, encrypted: true, remote: true, ageHours: 3 },
  drill: { present: true, ok: true, ageDays: 2 },
  emailEnabled: true,
  emailHref: "/admin/sistem?sekme=entegrasyonlar#entegrasyon-resend",
};

describe("operasyon hazırlık sinyalleri (B114/B115/B117)", () => {
  it("her şey hazırsa sinyal yok, çip yeşil", () => {
    expect(readinessSignals(READY)).toEqual([]);
    expect(systemStatusOf({ ok: true, cronErrors: 0, readiness: [] })).toEqual({ level: "ok", label: "Sistem çevrimiçi" });
  });

  it("kanal 0 iken çip uyarı ve 'Uyarı kanalı yok'; Dikkat kuyruğunda satır (sistem modülü)", () => {
    const signals = readinessSignals({ ...READY, channels: 0 });
    expect(signals.map((s) => s.id)).toEqual(["alert-channels"]);
    expect(systemStatusOf({ ok: true, cronErrors: 0, readiness: signals })).toEqual({ level: "warn", label: "Uyarı kanalı yok" });
    expect(systemStatusOf({ ok: true, cronErrors: 2, readiness: signals }).label).toBe("Uyarı kanalı yok · 3 uyarı");
    const input: AttentionInput = {
      refundRequired: 0,
      manualReview: 0,
      cronErrors: 0,
      efReconciliation: "ok",
      urgentTickets: 0,
      openTickets: 0,
      risk: 0,
      trialsEnding: 0,
      newTrials: 0,
      readiness: signals,
    };
    const rows = buildAttentionQueue(input, "super_admin");
    expect(rows.find((r) => r.id === "ops-alert-channels")).toMatchObject({ label: "Uyarı kanalı yok", href: "/admin/sistem?sekme=uyarilar" });
    // Sistem modülü olmayan rol bu satırı görmez.
    expect(buildAttentionQueue(input, "support").some((r) => r.id.startsWith("ops-"))).toBe(false);
  });

  it("kimseye gitmemiş kritik uyarı, şifresiz/yalnız yerel/eski yedek, tatbikat yokluğu ve kapalı e-posta ayrı satırlar", () => {
    const ids = readinessSignals({
      ...READY,
      unnotifiedCritical24h: 4,
      backup: { present: true, encrypted: false, remote: false, ageHours: 40 },
      drill: { present: false, ok: null, ageDays: null },
      emailEnabled: false,
    }).map((s) => s.id);
    expect(ids).toEqual(["critical-unnotified", "backup-stale", "email-off", "backup-unsafe", "drill-missing"]);
    const unsafe = readinessSignals({ ...READY, backup: { present: true, encrypted: false, remote: false, ageHours: 1 } })[0]!;
    expect(unsafe.label).toBe("Yedek şifresiz ve yalnız yerel");
  });

  it("okunamayan alan (null) sahte uyarı üretmez", () => {
    expect(readinessSignals({ ...READY, channels: null, unnotifiedCritical24h: null, backup: null, drill: null, emailEnabled: null })).toEqual([]);
  });
});

describe("abonelik durumu tutar önizlemesi = RPC tutar dalı (B118)", () => {
  const base = { requestedPlan: null, tenantPlan: "professional", subscriptionPlan: "professional", oldLockTry: null, oldLockCampaign: null, campaignLockAmountTry: null };

  it("plan değişmediyse kayıtlı tutar KORUNUR (Demo: 5.990, katalog 5.490 değil)", () => {
    expect(resolvePlanStatusAmount({ ...base, oldAmountTry: 5990, catalogAmountTry: 5490 })).toEqual({ nextPlan: "professional", planChanged: false, amountTry: 5990, source: "preserved" });
    // Aynı planı açıkça seçmek de değişiklik değildir.
    expect(resolvePlanStatusAmount({ ...base, requestedPlan: "professional", oldAmountTry: 5990, catalogAmountTry: 5490 }).amountTry).toBe(5990);
  });

  it("kayıtlı tutar yoksa kilit, o da yoksa katalog", () => {
    expect(resolvePlanStatusAmount({ ...base, oldAmountTry: 0, oldLockTry: 3990, catalogAmountTry: 5490 })).toMatchObject({ amountTry: 3990, source: "price_lock" });
    expect(resolvePlanStatusAmount({ ...base, oldAmountTry: null, catalogAmountTry: 5490 })).toMatchObject({ amountTry: 5490, source: "catalog" });
  });

  it("plan değişince: kampanya kilidi varsa yeni planın kilit fiyatı, yoksa katalog", () => {
    const changed = { ...base, requestedPlan: "business", oldAmountTry: 5990, catalogAmountTry: 9990 };
    expect(resolvePlanStatusAmount(changed)).toMatchObject({ planChanged: true, amountTry: 9990, source: "catalog" });
    expect(resolvePlanStatusAmount({ ...changed, oldLockCampaign: "founders", campaignLockAmountTry: 7990 })).toMatchObject({ amountTry: 7990, source: "price_lock" });
    // Kilit kampanyası var ama yeni planda kilit fiyatı yok: katalog.
    expect(resolvePlanStatusAmount({ ...changed, oldLockCampaign: "founders", campaignLockAmountTry: null })).toMatchObject({ amountTry: 9990, source: "catalog" });
  });

  it("plan değişikliği abonelik planına göre ölçülür (SQL: coalesce(abonelik, ofis))", () => {
    expect(nextPlanOf({ requestedPlan: null, tenantPlan: "office", subscriptionPlan: "professional" })).toEqual({ nextPlan: "office", planChanged: true });
    expect(nextPlanOf({ requestedPlan: "  ", tenantPlan: "office", subscriptionPlan: null })).toEqual({ nextPlan: "office", planChanged: false });
  });
});

describe("komut paleti biçimleri (B120/B192)", () => {
  it("talep numarası tam eşleşmeye çevrilir (sıfır dolgu, küçük harf, boşluk)", () => {
    expect(ticketNoQuery("ES-2026-000004")).toBe("ES-2026-000004");
    expect(ticketNoQuery(" es-2026-4 ")).toBe("ES-2026-000004");
    expect(ticketNoQuery("ES 2026")).toBeNull();
    expect(ticketNoQuery("fatura")).toBeNull();
  });

  it("alt başlıklar Türkçe; ham kod yok", () => {
    expect(tenantSubtitle({ plan: "professional", status: "active" })).not.toMatch(/professional|active/);
    expect(tenantSubtitle({ plan: "professional", status: "active" })).toContain("Aktif");
    expect(ticketSubtitle({ ticket_no: "ES-2026-000004", status: "in_progress", priority: "high" })).toBe("ES-2026-000004 · İşleniyor · Yüksek");
    expect(memberSubtitle({ email: "a@b.co", role: "owner", tenant_name: "Demo Emlak Ofisi", is_active: true })).toBe("a@b.co · Ofis sahibi · Demo Emlak Ofisi");
    expect(memberSubtitle({ email: null, role: "branch_manager", tenant_name: null, is_active: false })).toBe("Şube müdürü · Pasif");
  });
});

describe("cron ayrıntı özeti (B192)", () => {
  it("JSON insan özetine döner; ham JSON yalnız ayrıntıda", () => {
    const v = cronDetailView('{"objectsRemoved":3,"retention":"90 gün","escalated":0,"warned":2,"extra":{"a":1}}');
    expect(v.summary).toBe("3 nesne silindi, saklama: 90 gün, 0 yükseltme, 2 uyarı");
    expect(v.summary).not.toMatch(/objectsRemoved|\{/);
    expect(v.raw).toContain('"objectsRemoved": 3');
  });

  it("düz metin olduğu gibi; boş ayrıntı yok; kesik JSON ham metinde", () => {
    expect(cronDetailView("3 tetikte · 1 yeni")).toEqual({ summary: "3 tetikte · 1 yeni", raw: null });
    expect(cronDetailView(null)).toEqual({ summary: null, raw: null });
    expect(cronDetailView('{"a":1,"b":')).toMatchObject({ summary: "Ayrıntı kaydı (kısaltılmış)" });
    expect(humanizeKey("rowsScanned_total")).toBe("rows scanned total");
  });
});

describe("zorunlu entegrasyon ve şablon rozeti (B117)", () => {
  const card = { configured: false, alarm: null, stats: null, lastTest: null };
  it("Resend her zaman, iyzico canlı tahsilatta zorunlu; eksik zorunlu kart 'Sorunlu' sayılır", () => {
    expect(HUB_META.resend.required).toBe("always");
    expect(isRequiredHub("resend", { liveBilling: false })).toBe(true);
    expect(isRequiredHub("iyzico", { liveBilling: false })).toBe(false);
    expect(isRequiredHub("iyzico", { liveBilling: true })).toBe(true);
    expect(isRequiredHub("openai", { liveBilling: true })).toBe(false);
    expect(cardTone({ ...card, required: true })).toBe("danger");
    expect(cardTone({ ...card, required: false })).toBe("off");
    expect(isMissingRequired({ configured: false, required: true })).toBe(true);
    expect(isMissingRequired({ configured: true, required: true })).toBe(false);
  });

  it("kanal kapalıyken akışa bağlı şablon 'Kanal kapalı: gitmiyor'; auth (GoTrue) etkilenmez", () => {
    const wired = { usedBy: "KVKK başvuru formu", group: "destek" as const };
    expect(templateBadge(wired, true)).toEqual({ label: "Kullanımda", variant: "success" });
    expect(templateBadge(wired, false)).toEqual({ label: "Kanal kapalı: gitmiyor", variant: "danger" });
    expect(templateBadge({ usedBy: "Supabase Auth", group: "auth" }, false).variant).toBe("success");
    expect(templateBadge({ usedBy: "Henüz gönderilmiyor", group: "ofis" }, false).variant).toBe("neutral");
  });

  it("KVKK: kanal kapalıyken başvuru HİÇ yazılmaz (yarım kayıt yok), alternatif yol döner", async () => {
    const touched: string[] = [];
    const db = new Proxy({}, { get: (_t, k) => { touched.push(String(k)); throw new Error("DB'ye dokunulmamalı"); } });
    const send = async () => ({ ok: true as const });
    const parsed = { type: "access", name: "Ad Soyad", email: "a@b.co", phone: "", officeHint: null, details: "ayrıntı" } as unknown as Parameters<typeof submitApplication>[1];
    const r = await submitApplication(db as never, parsed, { nowMs: 0, send: send as never, channelOpen: false, alternatives: ["KEP: x@hs01.kep.tr"] });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ channelClosed: true });
    expect(!r.ok && r.error).toContain("KEP: x@hs01.kep.tr");
    expect(touched).toEqual([]);
  });

  it("KVKK: kanal kapalı mesajı alternatif yolu söyler, adres uydurmaz", () => {
    expect(channelClosedMessage(["KEP: x@hs01.kep.tr", ""])).toContain("KEP: x@hs01.kep.tr");
    expect(channelClosedMessage([])).toContain("destek e-posta adresimize");
  });
});

describe("/durum yaş sınırı (B017)", () => {
  it("en çok 60 sn yaşındaki anlık görüntü kullanılır, eskisi doğrudan okunur", () => {
    expect(STATUS_MAX_AGE_MS).toBeLessThanOrEqual(120_000);
    expect(isFreshSnapshot(1_000_000, 1_000_000 + STATUS_MAX_AGE_MS)).toBe(true);
    expect(isFreshSnapshot(1_000_000, 1_000_000 + STATUS_MAX_AGE_MS + 1)).toBe(false);
    // 52 dk bayat (gözlenen) değer asla dönmez.
    expect(isFreshSnapshot(0, 52 * 60_000)).toBe(false);
  });
});
