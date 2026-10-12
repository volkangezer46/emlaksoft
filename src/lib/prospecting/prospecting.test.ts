import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import { initialNextActionMs, nextActionAfterContactMs } from "./cadence";
import { conflictNotices, ownershipVerdict } from "./conflict";
import { buildFunnel } from "./funnel";
import { phoneHash } from "./phone-hash";
import { evaluatePriceChange } from "./price";
import { suggestRelist } from "./relist";
import { clampRetentionDays, isPurgeDue, PII_CLEAR_PATCH } from "./retention";
import { buildCallScript } from "./script";
import { actionsLocked, applyCallOutcome, canTransition, checkStatusChange } from "./state-machine";
import { CADENCE_DAYS, MAX_FAILED_ATTEMPTS } from "./thresholds";
import { parseListingUrl } from "./url";
import { fsboSaveSchema } from "./schema";

const NOW = Date.UTC(2026, 9, 12, 9, 0, 0);
const base = { status: "yeni" as const, contactAttempts: 0, firstSeenMs: NOW, doNotCall: false };

describe("durum akışı", () => {
  it("geçerli geçişler: yeni→arandi→randevu→yetki_alindi→portfoye_donustu; her adımdan kayıp; kayıp→yeni", () => {
    expect(canTransition("yeni", "arandi")).toBe(true);
    expect(canTransition("arandi", "randevu")).toBe(true);
    expect(canTransition("randevu", "yetki_alindi")).toBe(true);
    expect(canTransition("yetki_alindi", "portfoye_donustu")).toBe(true);
    for (const s of ["yeni", "arandi", "randevu", "yetki_alindi"] as const) expect(canTransition(s, "kayip")).toBe(true);
    expect(canTransition("kayip", "yeni")).toBe(true);
    expect(canTransition("yeni", "portfoye_donustu")).toBe(false);
  });

  it("portföye dönüşen kayıt geri alınamaz; kayıp neden ister", () => {
    expect(checkStatusChange({ from: "portfoye_donustu", to: "yeni" })).toMatchObject({ ok: false });
    expect(checkStatusChange({ from: "arandi", to: "kayip" })).toMatchObject({ ok: false });
    expect(checkStatusChange({ from: "arandi", to: "kayip", lostReason: "satti" })).toEqual({ ok: true });
    expect(checkStatusChange({ from: "kayip", to: "yeni" })).toEqual({ ok: true });
  });

  it("ulaşılamadı durumu değiştirmez, denemeyi artırır, ritme göre sonraki aramayı yazar", () => {
    const r = applyCallOutcome(base, "ulasilamadi", { nowMs: NOW });
    expect(r).toMatchObject({ ok: true, status: "yeni", contactAttempts: 1 });
    if (r.ok) expect(r.nextActionMs).toBe(NOW + CADENCE_DAYS[1] * DAY_MS);
  });

  it(`${MAX_FAILED_ATTEMPTS}. başarısız denemeden sonra "Kayıp: ulaşılamadı" önerilir (otomatik uygulanmaz)`, () => {
    const r = applyCallOutcome({ ...base, contactAttempts: MAX_FAILED_ATTEMPTS - 1 }, "ulasilamadi", { nowMs: NOW + 40 * DAY_MS });
    expect(r).toMatchObject({ ok: true, status: "yeni", suggestLost: "ulasilamadi" });
  });

  it("görüşüldü yeni kaydı arandı yapar; randevu ve yetki ilerletir; aranmasın kaydı kapatır", () => {
    expect(applyCallOutcome(base, "gorusuldu", { nowMs: NOW })).toMatchObject({ ok: true, status: "arandi" });
    expect(applyCallOutcome({ ...base, status: "arandi" }, "randevu", { nowMs: NOW })).toMatchObject({ ok: true, status: "randevu", nextActionMs: null });
    expect(applyCallOutcome({ ...base, status: "randevu" }, "yetki", { nowMs: NOW })).toMatchObject({ ok: true, status: "yetki_alindi" });
    expect(applyCallOutcome(base, "aranmasin", { nowMs: NOW })).toMatchObject({ ok: true, status: "kayip", doNotCall: true, lostReason: "emlakci_istemiyor" });
  });

  it("sonra ara: kullanıcının tarihi ritmi önceler", () => {
    const user = NOW + 10 * DAY_MS;
    const r = applyCallOutcome(base, "sonra_ara", { nowMs: NOW, userNextMs: user });
    expect(r.ok && r.nextActionMs).toBe(user);
  });

  it("aranmasın kilidi arama sonucunu engeller; kayıp ve dönüşen kayıt için arama açılamaz", () => {
    expect(applyCallOutcome({ ...base, doNotCall: true }, "gorusuldu", { nowMs: NOW })).toMatchObject({ ok: false });
    expect(applyCallOutcome({ ...base, status: "kayip" }, "gorusuldu", { nowMs: NOW })).toMatchObject({ ok: false });
    expect(applyCallOutcome({ ...base, status: "portfoye_donustu" }, "gorusuldu", { nowMs: NOW })).toMatchObject({ ok: false });
    expect(actionsLocked({ status: "yeni", doNotCall: true })).toBe(true);
    expect(actionsLocked({ status: "yeni", doNotCall: false })).toBe(false);
  });
});

describe("takip ritmi 0/3/7/14/21/30", () => {
  it("ilk kayıt aynı gün aranır", () => {
    expect(initialNextActionMs(NOW)).toBe(NOW);
  });
  it("her temastan sonra ilk görülmeden itibaren bir sonraki basamak", () => {
    const seq = [1, 2, 3, 4, 5].map((n) => nextActionAfterContactMs({ attemptsAfter: n, firstSeenMs: NOW, nowMs: NOW, userNextMs: null }));
    expect(seq.map((t) => (t - NOW) / DAY_MS)).toEqual([3, 7, 14, 21, 30]);
  });
  it("geçmişte kalan basamak ertesi güne ertelenir; 6 temastan sonra ayda bir", () => {
    const late = NOW + 20 * DAY_MS;
    expect(nextActionAfterContactMs({ attemptsAfter: 1, firstSeenMs: NOW, nowMs: late })).toBe(late + DAY_MS);
    expect(nextActionAfterContactMs({ attemptsAfter: 6, firstSeenMs: NOW, nowMs: late })).toBe(late + 30 * DAY_MS);
  });
});

describe("fiyat düşüşü", () => {
  it("eşik %1 ve üstü düşüş sinyaldir; yükseliş değildir", () => {
    expect(evaluatePriceChange(4_200_000, 3_990_000)).toMatchObject({ dropped: true, dropPct: 5 });
    expect(evaluatePriceChange(4_200_000, 4_190_000)).toMatchObject({ dropped: false });
    expect(evaluatePriceChange(4_000_000, 4_400_000)).toMatchObject({ dropped: false, raised: true });
    expect(evaluatePriceChange(null, 4_000_000)).toMatchObject({ dropped: false });
  });
});

describe("çakışma tespiti", () => {
  const lead = { assignedTo: "ayse", assignedName: "Ayşe", lastActivityMs: NOW - 2 * DAY_MS, claimExpiresMs: NOW + 5 * DAY_MS };
  it("başkası ilgileniyorsa ikinci danışman sahiplenemez", () => {
    const v = ownershipVerdict(lead, "mehmet", NOW, { canOverride: false });
    expect(v).toMatchObject({ kind: "other", daysAgo: 2 });
    if (v.kind === "other") expect(v.message).toContain("Ayşe");
  });
  it("kendi kaydı, sahipsiz, yönetici devri, hareketsizlikten düşen sahiplik", () => {
    expect(ownershipVerdict(lead, "ayse", NOW, { canOverride: false })).toEqual({ kind: "mine" });
    expect(ownershipVerdict({ ...lead, assignedTo: null }, "x", NOW, { canOverride: false })).toEqual({ kind: "free" });
    expect(ownershipVerdict(lead, "mudur", NOW, { canOverride: true })).toEqual({ kind: "free" });
    expect(ownershipVerdict({ ...lead, lastActivityMs: NOW - 15 * DAY_MS }, "mehmet", NOW, { canOverride: false })).toEqual({ kind: "free" });
    expect(ownershipVerdict({ ...lead, claimExpiresMs: NOW - 1 }, "mehmet", NOW, { canOverride: false })).toEqual({ kind: "free" });
  });
  it("uyarılar: aranmasın, ofis portföyü, müşteri", () => {
    const n = conflictNotices({ doNotCall: true, customer: { id: "c1", name: "Mehmet Yılmaz", type: "Satıcı" }, ownListing: { propertyId: "p1" } });
    expect(n.map((x) => x.key)).toEqual(["do_not_call", "own_listing", "customer"]);
    expect(n[2].message).toContain("Mehmet Yılmaz (Satıcı)");
    expect(conflictNotices({ doNotCall: false, customer: null, ownListing: null })).toEqual([]);
  });
  it("tekrar ilan: aynı telefon özeti kesin; ilçe+oda+m²+fiyat benzerliği öneri; farklı ilçe eşleşmez", () => {
    const prev = { id: "eski", phoneHash: "h1", districtId: "kadikoy", rooms: "3+1", sqm: 120, price: 4_200_000, title: "Moda 3+1" };
    expect(suggestRelist({ id: "yeni", phoneHash: "h1" }, [prev])).toMatchObject({ leadId: "eski", reason: "phone" });
    const similar = suggestRelist({ id: "yeni", phoneHash: "h2", districtId: "kadikoy", rooms: "3+1", sqm: 121, price: 4_100_000, title: "Moda 3+1" }, [prev]);
    expect(similar).toMatchObject({ leadId: "eski", reason: "similar" });
    expect(suggestRelist({ id: "yeni", phoneHash: "h2", districtId: "besiktas", rooms: "3+1", sqm: 121, price: 4_100_000 }, [prev])).toBeNull();
    expect(suggestRelist({ id: "eski", phoneHash: "h1" }, [prev])).toBeNull();
  });
});

describe("saklama süresi", () => {
  it("ofis ayarı 30-180 gün; dışı varsayılan 90", () => {
    expect(clampRetentionDays(90)).toBe(90);
    expect(clampRetentionDays(30)).toBe(30);
    expect(clampRetentionDays(180)).toBe(180);
    expect(clampRetentionDays(10)).toBe(90);
    expect(clampRetentionDays(400)).toBe(90);
    expect(clampRetentionDays("x")).toBe(90);
  });
  it("son etkinlikten sonra silinir; dönüşen ve zaten temizlenmiş kayıt kapsam dışı", () => {
    const c = { id: "1", status: "arandi", lastActivityMs: NOW - 91 * DAY_MS, piiPurged: false };
    expect(isPurgeDue(c, 90, NOW)).toBe(true);
    expect(isPurgeDue({ ...c, lastActivityMs: NOW - 89 * DAY_MS }, 90, NOW)).toBe(false);
    expect(isPurgeDue({ ...c, status: "portfoye_donustu" }, 90, NOW)).toBe(false);
    expect(isPurgeDue({ ...c, piiPurged: true }, 90, NOW)).toBe(false);
    expect(isPurgeDue({ ...c, lastActivityMs: NOW - 31 * DAY_MS }, 30, NOW)).toBe(true);
  });
  it("temizlik yalnız kişisel alanları siler; istatistik alanlarına dokunmaz", () => {
    expect(Object.keys(PII_CLEAR_PATCH).sort()).toEqual(["owner_name", "phone", "phone_hash"]);
  });
});

describe("telefon özeti, bağlantı ve girdi doğrulama", () => {
  it("özet kiracı tuzludur ve kararlıdır; ham numara içermez", () => {
    const a = phoneHash("t1", "05321234567");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneHash("t1", "05321234567")).toBe(a);
    expect(phoneHash("t2", "05321234567")).not.toBe(a);
    expect(a).not.toContain("5321234567");
  });
  it("yalnız bilinen portal bağlantıları kabul edilir", () => {
    expect(parseListingUrl("https://www.sahibinden.com/ilan/emlak-konut-satilik-moda-3-1-1234567890/detay?x=1")).toMatchObject({ portal: "sahibinden", externalId: "1234567890" });
    expect(parseListingUrl("https://evil.example.com/ilan/1234567890")).toBeNull();
    expect(parseListingUrl("javascript:alert(1)")).toBeNull();
    expect(parseListingUrl("")).toBeNull();
  });
  it("kayıt şeması: telefon parsePhoneStrict ile saklama biçimine çevrilir, geçersizi reddeder", () => {
    const ok = fsboSaveSchema.safeParse({ url: "https://www.sahibinden.com/ilan/x-1234567890/detay", phone: "0532 123 45 67", price: "4.200.000" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ phone: "05321234567", price: 4200000, portal: "sahibinden", externalId: "1234567890" });
    expect(fsboSaveSchema.safeParse({ url: "https://www.sahibinden.com/ilan/x-1234567890/detay", phone: "123" }).success).toBe(false);
    expect(fsboSaveSchema.safeParse({ url: "https://example.com/x" }).success).toBe(false);
    expect(fsboSaveSchema.safeParse({}).success).toBe(false);
  });
});

describe("script ve huni", () => {
  it("açılışta ofis unvanı ve yetki belge no; değer cümlesi veri yoksa çıkmaz; fiyat vaadi yok", () => {
    const s = buildCallScript({ advisorName: "Ayşe", officeName: "Moda Gayrimenkul", licenseNo: "34-1234", districtName: "Kadıköy", rooms: "3+1", portalLabel: "Sahibinden" });
    const text = s.flatMap((x) => x.lines).join(" ");
    expect(s[0].lines[0]).toContain("Moda Gayrimenkul");
    expect(s[0].lines[0]).toContain("yetki belge no 34-1234");
    expect(s.some((x) => x.title === "Neden arıyorum")).toBe(false);
    expect(text).not.toMatch(/daha yüksek fiyat/i);
    const withDemand = buildCallScript({ advisorName: "A", officeName: "O", licenseNo: null, districtName: null, rooms: null, portalLabel: "Sahibinden", activeBuyerDemands: 3 });
    expect(withDemand.some((x) => x.title === "Neden arıyorum")).toBe(true);
  });
  it("huni: danışman başına adetler, dönüşüm oranı ve kayıp nedenleri", () => {
    const rows = buildFunnel([
      { assigned_to: "a", status: "yeni", lost_reason: null },
      { assigned_to: "a", status: "portfoye_donustu", lost_reason: null },
      { assigned_to: "a", status: "kayip", lost_reason: "satti" },
      { assigned_to: "a", status: "kayip", lost_reason: "satti" },
      { assigned_to: null, status: "yetki_alindi", lost_reason: null },
    ]);
    const a = rows.find((r) => r.advisorId === "a")!;
    expect(a).toMatchObject({ total: 4, conversionPct: 25, topReason: "satti" });
    expect(a.byReason.satti).toBe(2);
    expect(rows.find((r) => r.advisorId === "sahipsiz")).toMatchObject({ total: 1, authorityPct: 100 });
  });
});
