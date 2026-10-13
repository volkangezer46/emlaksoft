import { DAY_MS } from "@/lib/clock";
import { trDateEndMs } from "@/lib/billing/admin-billing-fixes";
import { evaluatePlanChange, remainingRatio, type PlanChangeEval } from "@/lib/billing/plan-change-core";
import type { BillingCycle, PlanDef } from "@/lib/billing/plans";

/**
 * ABONELİK OPERASYON KONSOLU (Ofis 360 > Abonelik): SAF KURALLAR (I/O yok; istemci ve sunucu paylaşır, testli).
 * Sunucu action'ı (`app/actions/platform-subscription-ops.ts`) bağlayıcı hesabı bu fonksiyonlarla yapar; ekran
 * aynı fonksiyonla önizler. Tutar istemciden ALINMAZ (onay tutarı yalnız "ekrandaki tutar değişti mi" kontrolüdür).
 */

// ---------------------------------------------------------------------------
// İptal nedeni
// ---------------------------------------------------------------------------

export const CANCEL_REASONS = [
  { code: "fiyat", label: "Fiyat yüksek" },
  { code: "kullanmiyor", label: "Yeterince kullanılmıyor" },
  { code: "ozellik_eksik", label: "Eksik özellik" },
  { code: "rakip", label: "Rakip ürüne geçti" },
  { code: "ofis_kapandi", label: "Ofis kapandı / faaliyet durdu" },
  { code: "odeme_sorunu", label: "Ödeme sorunu" },
  { code: "memnuniyetsizlik", label: "Hizmetten memnun değil" },
  { code: "diger", label: "Diğer" },
] as const;

export type CancelReasonCode = (typeof CANCEL_REASONS)[number]["code"];

export function isCancelReasonCode(v: unknown): v is CancelReasonCode {
  return typeof v === "string" && CANCEL_REASONS.some((r) => r.code === v);
}

export function cancelReasonLabel(code: string | null | undefined): string | null {
  return CANCEL_REASONS.find((r) => r.code === code)?.label ?? null;
}

/**
 * Raporlarda görünen `cancel_reason` metni: neden ETİKETİ (gruplanabilir). Not ayrı sütunda (`cancel_note`);
 * sütun yoksa (migration bekliyor) not etikete eklenir ki kaybolmasın.
 */
export function cancelReasonText(code: CancelReasonCode, note: string | null, noteColumn: boolean): string {
  const label = cancelReasonLabel(code) ?? "Diğer";
  if (noteColumn || !note) return label;
  return `${label}: ${note}`.slice(0, 500);
}

// ---------------------------------------------------------------------------
// Tahsil denemeleri
// ---------------------------------------------------------------------------

export type AttemptTone = "ok" | "warn" | "danger" | "muted";

export type AttemptInvoiceRow = {
  id: string;
  invoice_no: string | null;
  status: string;
  checkout_status: string | null;
  checkout_error?: string | null;
  total_try: number | string | null;
  created_at: string;
  paid_at?: string | null;
  meta?: Record<string, unknown> | null;
};

export type AttemptCaptureRow = {
  id: string;
  invoice_id: string | null;
  status: string;
  attempt_count: number | null;
  last_error_code: string | null;
  captured_at: string | null;
  amount_try: number | string | null;
};

export type PaymentAttempt = {
  id: string;
  invoiceId: string | null;
  invoiceNo: string | null;
  atIso: string;
  amountTry: number;
  source: string;
  outcome: string;
  tone: AttemptTone;
  /** Hata/sonuç açıklaması (yoksa null). */
  errorText: string | null;
};

/** iyzico kart/ödeme ret kodları (sık görülenler); bilinmeyen kod yine kodla gösterilir. */
const PROVIDER_ERRORS: Record<string, string> = {
  "10005": "İşlem bankaca onaylanmadı",
  "10012": "Geçersiz işlem",
  "10041": "Kayıp kart, karta el koyunuz",
  "10043": "Çalıntı kart, karta el koyunuz",
  "10051": "Kart limiti yetersiz, yetersiz bakiye",
  "10054": "Son kullanma tarihi hatalı",
  "10057": "Kart sahibi bu işlemi yapamaz",
  "10058": "Terminalin bu işlemi yapma yetkisi yok",
  "10084": "Kart güvenlik kodu hatalı",
  "10093": "Kart internetten alışverişe kapalı",
  "10201": "Kart işleme izin vermedi",
  "10204": "Ödeme işlemi sırasında genel bir hata oluştu",
  "10206": "Kart güvenlik kodu uzunluğu geçersiz",
  "10207": "Bankanızdan onay alınız",
  "10209": "Bloke statülü kart",
  "10215": "Geçersiz kart numarası",
  "10219": "Bankaya gönderilen istek zaman aşımına uğradı",
  "10225": "Kısıtlı kart",
  "10228": "Banka veya terminal işlem yapamıyor",
  "10229": "Son kullanma tarihi geçersiz",
};

/** Mutabakat (capture) hata kodları: Postgres hata sınıfı ya da iç kod. */
const CAPTURE_ERRORS: Record<string, string> = {
  "22023": "Ödeme alındı ama fatura/tutar doğrulaması geçmedi (iade gerekebilir)",
  "23505": "Aynı ödeme zaten işlenmiş (çift kayıt engellendi)",
  P0002: "Ödeme alındı ama fatura ya da abonelik bulunamadı",
  P0001: "Ödeme alındı ama kural ihlali (ör. plan limiti) nedeniyle elle inceleme bekliyor",
  unknown_provider_outcome: "Sağlayıcı sonucu belirsiz; mutabakat bekleniyor",
  max_attempts_exceeded: "Yeniden deneme sınırı aşıldı; elle inceleme gerekli",
};

/** Saklanan hata metnini okunur Türkçeye çevirir: "10051: ..." → banka açıklaması (kodla). */
export function providerErrorText(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const code = /^([A-Za-z0-9_]+)/.exec(v)?.[1] ?? "";
  if (PROVIDER_ERRORS[code]) return `${PROVIDER_ERRORS[code]} (kod ${code})`;
  if (CAPTURE_ERRORS[code]) return `${CAPTURE_ERRORS[code]} (kod ${code})`;
  return v.slice(0, 300);
}

const SOURCE_LABEL: Record<string, string> = {
  auto_renew: "Otomatik yenileme",
  checkout: "Kartla ödeme",
  payment_link: "Ödeme bağlantısı",
  admin: "Yönetici",
};

function attemptOutcomeOf(inv: AttemptInvoiceRow): { outcome: string; tone: AttemptTone; fallback: string | null } {
  if (inv.status === "paid") return { outcome: "Başarılı", tone: "ok", fallback: null };
  switch (inv.checkout_status) {
    case "initialization_failed":
      return { outcome: "Başarısız", tone: "danger", fallback: "Ödeme başlatılamadı ya da banka reddetti (sağlayıcı ayrıntı bildirmedi)" };
    case "initialized":
      return { outcome: "Sonuç belirsiz", tone: "warn", fallback: "Ödeme başlatıldı, sonuç doğrulanmadı; mutabakat çözer (yeni tahsilat yapılmaz)" };
    case "captured_pending":
      return { outcome: "Tahsil edildi", tone: "warn", fallback: "Ödeme alındı, abonelik işlemesi bekliyor" };
    case "fulfilled":
      return { outcome: "Başarılı", tone: "ok", fallback: null };
    case "expired":
      return { outcome: "Süresi doldu", tone: "muted", fallback: "Ödeme oturumu tamamlanmadan süresi doldu" };
    case "pending_checkout":
      return { outcome: "Başlatılmadı", tone: "muted", fallback: "Ödeme ekranı açıldı, kart bilgisi gönderilmedi" };
    default:
      return { outcome: inv.status === "void" ? "İptal" : "Bekliyor", tone: "muted", fallback: null };
  }
}

/**
 * Son N tahsil denemesi (ödeme oturumu açılmış faturalar, en yeni önce). Hata metni öncelik sırası:
 * faturadaki sağlayıcı hata metni → aynı faturanın mutabakat (capture) hata kodu → durumdan türetilen açıklama.
 */
export function buildPaymentAttempts(
  invoices: readonly AttemptInvoiceRow[],
  captures: readonly AttemptCaptureRow[],
  limit = 10,
): PaymentAttempt[] {
  const captureByInvoice = new Map<string, AttemptCaptureRow>();
  for (const c of captures) if (c.invoice_id && !captureByInvoice.has(c.invoice_id)) captureByInvoice.set(c.invoice_id, c);
  return invoices
    .filter((i) => i.checkout_status != null)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, limit)
    .map((inv) => {
      const o = attemptOutcomeOf(inv);
      const cap = captureByInvoice.get(inv.id);
      const source = String((inv.meta ?? {}).source ?? "checkout");
      const errorText =
        providerErrorText(inv.checkout_error) ??
        (cap?.last_error_code ? providerErrorText(cap.last_error_code) : null) ??
        o.fallback;
      return {
        id: inv.id,
        invoiceId: inv.id,
        invoiceNo: inv.invoice_no,
        atIso: inv.created_at,
        amountTry: Number(inv.total_try ?? 0) || 0,
        source: SOURCE_LABEL[source] ?? source,
        outcome: o.outcome,
        tone: o.tone,
        errorText,
      };
    });
}

// ---------------------------------------------------------------------------
// Paket değişikliği (yönetici)
// ---------------------------------------------------------------------------

export type AdminPlanTiming = "now" | "period_end";
export type AdminProration = "prorate" | "none";

export type AdminPlanState = {
  planId: string;
  status: string | null;
  cycle: BillingCycle;
  periodStartMs: number | null;
  periodEndMs: number | null;
  lockedMonthlyTry: number | null;
  pendingPlan: string | null;
  paused: boolean;
  /** Fiyat kilidi kampanyası (Founders vb.); kampanyasız kilit paket değişince kaldırılır. */
  priceLockCampaign?: string | null;
};

export type AdminPlanChangeInput = {
  plans: readonly PlanDef[];
  state: AdminPlanState;
  toPlanId: string;
  timing: AdminPlanTiming;
  proration: AdminProration;
  nowMs: number;
  paidCapNetTry?: number | null;
  usedSeats?: number;
  extraSeats?: number;
  /**
   * Yeni paketin ÇÖZÜLMÜŞ koltuk limiti (ofise özel istisna + ek koltuk; `resolveSeatLimit`). Verilirse kapasite
   * kontrolü bununla yapılır (DB tetikleyicisiyle aynı); null = sınırsız. Verilmezse plan + ek (eski davranış).
   */
  targetSeatLimit?: number | null;
};

export type AdminPlanChangePreview =
  | { ok: false; error: string }
  | {
      ok: true;
      kind: "schedule" | "immediate";
      /** Planlı değişiklik zamanı (schedule) ya da null. */
      effectiveAtMs: number | null;
      /** Kesilecek fark faturasının NET tutarı (KDV hariç); 0 = fatura yok. */
      invoiceNetTry: number;
      /** Düşürmede bilgi amaçlı kalan süre farkı (otomatik iade/kredi YOK). */
      downgradeCreditInfoTry: number;
      evaluation: PlanChangeEval | null;
      message: string;
      /** Özel anlaşma fiyat kilidi paket değişince kaldırılır/yeniden yazılır: onaydan önce gösterilen uyarı. */
      priceLockNote: string | null;
    };

const tl = (n: number) => `${Math.round(n).toLocaleString("tr-TR")} ₺`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Yönetici paket değişikliği önizlemesi. Kurallar:
 *  - `period_end`: planlı değişiklik (pending_plan); dönem sonunda gece kontrolü uygular. Kıst hesap yapılmaz.
 *    Yalnız dönemi süren aktif/gecikmiş abonelikte.
 *  - `now` + `none`: hemen uygulanır, fatura kesilmez.
 *  - `now` + `prorate`: `evaluatePlanChange` (kullanıcı akışıyla AYNI formül; gizli paketler yönetici için seçilebilir).
 *    Yükseltmede kalan süre farkı için fatura satırı oluşur; düşürmede iade/kredi otomatik verilmez (bilgi gösterilir).
 */
/**
 * Paket değişince fiyat kilidi ne olur (update_tenant_plan_subscription + subscription_apply_scheduled_plan_changes ile
 * aynı kural): kampanyasız kilit KALDIRILIR (tutar yeni paketin katalog fiyatı olur); kampanyalı kilit yeni paketin
 * kampanya fiyatıyla yeniden yazılır (yeni pakette kampanya fiyatı yoksa kaldırılır). Kilit yoksa null.
 */
export function priceLockChangeNote(lockedMonthlyTry: number | null, campaign: string | null | undefined, toName: string): string | null {
  if (lockedMonthlyTry == null || !(lockedMonthlyTry > 0)) return null;
  if (campaign) {
    return `Fiyat kilidi (${tl(lockedMonthlyTry)}/ay, ${campaign}) ${toName} paketinin kampanya fiyatıyla yeniden yazılır; o pakette kampanya fiyatı yoksa kilit kaldırılır.`;
  }
  return `Özel anlaşma fiyat kilidi (${tl(lockedMonthlyTry)}/ay) paket değişince KALDIRILIR; sonraki yenileme ${toName} paketinin katalog fiyatıyla yapılır. Gerekirse değişiklikten sonra "Özel anlaşma" kartından yeniden tanımlayın.`;
}

export function previewAdminPlanChange(input: AdminPlanChangeInput): AdminPlanChangePreview {
  const { state } = input;
  const to = input.plans.find((p) => p.id === input.toPlanId);
  if (!to) return { ok: false, error: "Paket bulunamadı." };
  if (to.id === state.planId) return { ok: false, error: "Ofis zaten bu paketi kullanıyor." };
  if (state.paused) return { ok: false, error: "Abonelik duraklatılmış; paket değiştirmek için önce devam ettirin." };
  const priceLockNote = priceLockChangeNote(state.lockedMonthlyTry, state.priceLockCampaign, to.name);

  if (input.timing === "period_end") {
    if (state.status !== "active" && state.status !== "past_due") {
      return { ok: false, error: "Dönem sonunda değişiklik yalnız aktif ya da gecikmiş abonelikte planlanabilir." };
    }
    if (state.periodEndMs == null || state.periodEndMs <= input.nowMs) {
      return { ok: false, error: "Süren bir dönem yok; değişikliği hemen uygulayın." };
    }
    if (state.pendingPlan === to.id) return { ok: false, error: "Bu paket zaten dönem sonu için planlı." };
    return {
      ok: true,
      kind: "schedule",
      effectiveAtMs: state.periodEndMs,
      invoiceNetTry: 0,
      downgradeCreditInfoTry: 0,
      evaluation: null,
      message: `${to.name} paketi mevcut dönemin sonunda uygulanır; o zamana kadar mevcut paket sürer. Fatura kesilmez.`,
      priceLockNote,
    };
  }

  if (input.proration === "none") {
    return {
      ok: true,
      kind: "immediate",
      effectiveAtMs: null,
      invoiceNetTry: 0,
      downgradeCreditInfoTry: 0,
      evaluation: null,
      message: `${to.name} paketine hemen geçilir; kıst fark hesaplanmaz ve fatura kesilmez. Sonraki yenileme yeni paketin tutarıyla yapılır.`,
      priceLockNote,
    };
  }

  // Yönetici gizli (çevrimiçi satılmayan) paketi de seçebilir: kıst formülü aynı kalır.
  const plans = input.plans.map((p) => (p.hidden ? { ...p, hidden: false } : p));
  // Çözülmüş limit verildiyse kapasite burada (istisna dahil) kontrol edilir; formüle plan + ek kontrolü bırakılmaz.
  const resolvedCheck = input.targetSeatLimit !== undefined;
  if (resolvedCheck && input.targetSeatLimit != null && input.usedSeats != null && input.usedSeats > input.targetSeatLimit) {
    return {
      ok: false,
      error: `${to.name} paketinde en fazla ${input.targetSeatLimit} kullanıcı olur; şu an ${input.usedSeats} aktif kullanıcı var. Önce kullanıcı sayısını azaltın.`,
    };
  }
  const ev = evaluatePlanChange({
    plans,
    fromPlanId: state.planId,
    toPlanId: to.id,
    cycle: state.cycle,
    lockedMonthlyTry: state.lockedMonthlyTry,
    paidCapNetTry: input.paidCapNetTry ?? null,
    periodStartMs: state.periodStartMs,
    periodEndMs: state.periodEndMs,
    nowMs: input.nowMs,
    usedSeats: resolvedCheck ? undefined : input.usedSeats,
    extraSeats: input.extraSeats,
  });
  const base = { ok: true as const, kind: "immediate" as const, effectiveAtMs: null, evaluation: ev, priceLockNote };
  switch (ev.status) {
    case "upgrade":
      return {
        ...base,
        invoiceNetTry: ev.chargeNetTry,
        downgradeCreditInfoTry: 0,
        message: `Kalan %${Math.round(ev.ratio * 100)} dönem için ${tl(ev.newCostTry)} yeni paket bedelinden ${tl(ev.creditTry)} mevcut paket kredisi düşülür; ${tl(ev.chargeNetTry)} + KDV fark faturası kesilir. Paket hemen değişir.`,
      };
    case "downgrade": {
      const info = round2(Math.max(0, ev.fromPeriodTry - ev.toPeriodTry) * ev.ratio);
      return {
        ...base,
        invoiceNetTry: 0,
        downgradeCreditInfoTry: info,
        message: `Paket hemen düşer. Kalan süre farkı yaklaşık ${tl(info)} (KDV hariç); iade ya da kredi OTOMATİK verilmez, gerekiyorsa Hesap kredisi panelinden elle tanımlayın.`,
      };
    }
    case "over_capacity":
      return { ok: false, error: ev.message };
    case "unknown_plan":
    case "same_plan":
      return { ok: false, error: ev.message };
    default:
      // tiny_charge, no_period, period_over, same_price, not_sold: kıst tutar çıkmaz.
      return {
        ...base,
        invoiceNetTry: 0,
        downgradeCreditInfoTry: 0,
        message: `Kıst fark çıkmadı (${ev.message.replace(/\.$/, "")}). Paket hemen değişir, fatura kesilmez.`,
      };
  }
}

/** Önizleme → onay arasında izin verilen en uzun süre (gerekçe yazma payı). */
export const QUOTE_MAX_AGE_MS = 10 * 60_000;

/**
 * Kıst tutar milisaniye hassasiyetli orandan çıkar (zamanla kayar). Onay, önizlemenin hesaplandığı ANI (`quoted_at_ms`)
 * yeniden kullanır; böylece aynı girdiyle aynı tutar çıkar ve gerekçe yazmak tutarı "değiştirmez". Anı kabul kuralı:
 * geçerli tam sayı, gelecekte değil, en çok `QUOTE_MAX_AGE_MS` önce ve (biliniyorsa) mevcut dönemin başından sonra
 * (arada yenileme olduysa eski an yeni dönemi fiyatlayamaz). Geçersizse null: "yeniden önizleyin".
 */
export function resolveQuoteTime(raw: unknown, nowMs: number, periodStartMs: number | null = null): number | null {
  const s = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!/^[0-9]{10,16}$/.test(s)) return null;
  const t = Number(s);
  if (!Number.isSafeInteger(t) || t > nowMs || nowMs - t > QUOTE_MAX_AGE_MS) return null;
  if (periodStartMs != null && t < periodStartMs) return null;
  return t;
}

/** Kalan dönem oranı (ekran bilgisi; dönem yoksa 0). */
export function periodRemainingPercent(startMs: number | null, endMs: number | null, nowMs: number): number {
  if (startMs == null || endMs == null) return 0;
  return Math.round(remainingRatio(startMs, endMs, nowMs) * 100);
}

// ---------------------------------------------------------------------------
// Özel anlaşma (fiyat kilidi + taahhüt)
// ---------------------------------------------------------------------------

export const DEAL_PRICE_MAX_TRY = 1_000_000;
/** Taahhüt bitişi en çok bugünden bu kadar gün ileri (5 yıl). */
export const COMMITMENT_MAX_AHEAD_DAYS = 5 * 366;

export type DealInput = { priceLock: unknown; seatBase: unknown; commitmentDate: unknown };
export type ParsedDeal =
  | { ok: true; priceLockTry: number | null; seatBaseTry: number | null; commitmentEndIso: string | null }
  | { ok: false; error: string };

function parseMoney(raw: unknown, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const v = typeof raw === "string" ? raw.trim().replace(/\./g, "").replace(",", ".") : typeof raw === "number" ? String(raw) : "";
  if (v === "") return { ok: true, value: null };
  if (!/^[0-9]{1,7}(\.[0-9]{1,2})?$/.test(v)) return { ok: false, error: `${label}: geçerli bir tutar girin (en fazla 2 ondalık).` };
  const n = Number(v);
  if (!(n > 0) || n > DEAL_PRICE_MAX_TRY) return { ok: false, error: `${label} 0'dan büyük ve en çok ${DEAL_PRICE_MAX_TRY.toLocaleString("tr-TR")} ₺ olmalı.` };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** Anlaşma formu: boş alan = kilidi/taahhüdü kaldır. Tarih "YYYY-AA-GG" (o TR gününün sonu), geçmiş olamaz. */
export function parseDealInput(input: DealInput, nowMs: number): ParsedDeal {
  const price = parseMoney(input.priceLock, "Paket fiyat kilidi");
  if (!price.ok) return price;
  const seat = parseMoney(input.seatBase, "Koltuk taban fiyat kilidi");
  if (!seat.ok) return seat;
  const rawDate = typeof input.commitmentDate === "string" ? input.commitmentDate.trim() : "";
  let commitmentEndIso: string | null = null;
  if (rawDate) {
    const end = trDateEndMs(rawDate);
    if (end == null) return { ok: false, error: "Taahhüt bitişi için geçerli bir tarih seçin." };
    if (end <= nowMs) return { ok: false, error: "Taahhüt bitişi bugünden sonra olmalı." };
    if (end > nowMs + COMMITMENT_MAX_AHEAD_DAYS * DAY_MS) return { ok: false, error: "Taahhüt bitişi en çok 5 yıl sonrası olabilir." };
    commitmentEndIso = new Date(end).toISOString();
  }
  return { ok: true, priceLockTry: price.value, seatBaseTry: seat.value, commitmentEndIso };
}

/** Fiyat kilidinde kaydedilen aylık tutar: kilit liste fiyatını aşamaz (plan-change-core `currentPeriodAmount` ile aynı). */
export function lockedMonthlyAmount(listMonthlyTry: number, priceLockTry: number | null): number {
  return priceLockTry && priceLockTry > 0 ? Math.min(priceLockTry, listMonthlyTry) : listMonthlyTry;
}

/** Bitiş tarihi (istisna): boş = süresiz; "YYYY-AA-GG" o TR gününün sonu, bugünden sonra ve ≤ 5 yıl. */
export function parseExpiryDate(raw: unknown, nowMs: number): { ok: true; iso: string | null } | { ok: false; error: string } {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return { ok: true, iso: null };
  const end = trDateEndMs(v);
  if (end == null) return { ok: false, error: "Bitiş için geçerli bir tarih seçin." };
  if (end <= nowMs) return { ok: false, error: "Bitiş tarihi bugünden sonra olmalı." };
  if (end > nowMs + COMMITMENT_MAX_AHEAD_DAYS * DAY_MS) return { ok: false, error: "Bitiş en çok 5 yıl sonrası olabilir." };
  return { ok: true, iso: new Date(end).toISOString() };
}
