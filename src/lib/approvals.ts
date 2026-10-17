/**
 * Onay akışları — saf yardımcılar (tek doğruluk kaynağı).
 *
 * Neden ayrı modül: tür sözlüğü, delta metni ve SLA eşiği hem sayfada (server
 * component), hem action'larda (bildirim metni), hem de testte kullanılıyor.
 * DB'ye ya da React'e bağlı hiçbir şey YOK — bu dosya saf, birim testle kapalı.
 *
 * Zaman: `isOverdue` şimdiyi PARAMETRE alır (`nowMs`). Modül içinde `Date.now()`
 * çağırmak render saflığını bozardı (bkz. `src/lib/clock.ts` başlığı); çağıran
 * `now()` ile okur, buraya geçirir.
 */
import { isApprovalExemptRole, MANAGEMENT_TIER_ROLES } from "@/lib/team/assignable-roles";
import { effectiveHasPermission, type EffectivePermissions } from "@/lib/permissions-merge";

export const APPROVAL_KINDS = [
  "komisyon_indirimi",
  "gider",
  "fiyat_degisikligi",
  "ozel_izin",
  "diger",
] as const;

export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_STATUSES = ["bekliyor", "onaylandi", "reddedildi", "iptal"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Değerin birimi: yüzde mi para mı — delta metnini ve form etiketini belirler. */
export type ApprovalUnit = "yuzde" | "para" | "yok";

export type ApprovalKindMeta = {
  label: string;
  /** lucide-react ikon ADI (bileşen değil — bu dosya saf kalsın diye). */
  icon: string;
  /** Rozet renk tonu — panelin token'ları (mor yok). */
  tone: "brand" | "amber" | "mint" | "danger" | "neutral";
  unit: ApprovalUnit;
  /** Yeni talep formunda "mevcut/talep edilen" alan etiketleri. */
  currentLabel: string;
  requestedLabel: string;
};

export const APPROVAL_KIND_META: Record<ApprovalKind, ApprovalKindMeta> = {
  komisyon_indirimi: {
    label: "Komisyon indirimi",
    icon: "Percent",
    tone: "amber",
    unit: "yuzde",
    currentLabel: "Standart oran (%)",
    requestedLabel: "Teklif edilen oran (%)",
  },
  gider: {
    label: "Olağandışı gider",
    icon: "Receipt",
    tone: "danger",
    unit: "para",
    currentLabel: "Bütçe / onaylı tutar (₺)",
    requestedLabel: "Talep edilen tutar (₺)",
  },
  fiyat_degisikligi: {
    label: "Fiyat değişikliği",
    icon: "TrendingDown",
    tone: "brand",
    unit: "para",
    currentLabel: "Mevcut fiyat (₺)",
    requestedLabel: "Talep edilen fiyat (₺)",
  },
  ozel_izin: {
    label: "Özel izin",
    icon: "KeyRound",
    tone: "mint",
    unit: "yok",
    currentLabel: "Mevcut durum",
    requestedLabel: "Talep edilen",
  },
  diger: {
    label: "Diğer",
    icon: "CircleHelp",
    tone: "neutral",
    unit: "yok",
    currentLabel: "Mevcut değer",
    requestedLabel: "Talep edilen değer",
  },
};

/** Bilinmeyen/eski `kind` değerleri sessizce "Diğer" gibi davranır — sayfa patlamaz. */
export function kindMeta(kind: string): ApprovalKindMeta {
  return APPROVAL_KIND_META[kind as ApprovalKind] ?? APPROVAL_KIND_META.diger;
}

export function isApprovalKind(v: string): v is ApprovalKind {
  return (APPROVAL_KINDS as readonly string[]).includes(v);
}

export function isApprovalStatus(v: string): v is ApprovalStatus {
  return (APPROVAL_STATUSES as readonly string[]).includes(v);
}

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  bekliyor: "Bekliyor",
  onaylandi: "Onaylandı",
  reddedildi: "Reddedildi",
  iptal: "İptal edildi",
};

/** Durum sekmesine göre liste/grafik başlığı (ek gerektirmeyen ad öbeği; "Bekliyor talepler" yazılmaz). */
export const APPROVAL_STATUS_HEADING: Record<ApprovalStatus, string> = {
  bekliyor: "Bekleyen talepler",
  onaylandi: "Onaylanan talepler",
  reddedildi: "Reddedilen talepler",
  iptal: "İptal edilen talepler",
};

/**
 * Karar verebilen roller.
 *
 * `src/lib/permissions.ts` matrisinden okundu: yönetim kademesi owner / gm /
 * branch_manager / team_lead. `accounting` komisyonda tam CRUD'a sahip ama
 * KADEMESİ yönetici değil — hakediş kaydını işler, indirim politikasına karar
 * vermez; bu yüzden listede yok. Yetki kapısı ayrıca `commissions:edit` ister,
 * yani rol listesi TEK başına yetmez (bkz. actions/approvals.ts).
 */
export const APPROVAL_DECIDER_ROLES: readonly string[] = MANAGEMENT_TIER_ROLES;

export function isApprovalDeciderRole(role: string | null | undefined): boolean {
  return APPROVAL_DECIDER_ROLES.includes(String(role ?? ""));
}

/**
 * KARAR YETKİSİ — TEK yüklem (SK10 / B164): yönetim kademesi + etkin `commissions:edit`. Onaylar sayfasındaki
 * Onayla/Reddet ve toplu karar, menü rozeti (nav-badges, bootstrap-core), yeni talep bildiriminin alıcıları ve
 * `decideApproval` bunu kullanır; "düğmeyi gören karar verebilir". Şube müdürü/takım liderinin varsayılan matrisinde
 * komisyon yalnız `view` olduğundan karar düğmesi görmezler; ofis rol istisnasıyla `edit` verilirse görürler (sahip kararı).
 */
export function canDecideApproval(role: string | null | undefined, perms: EffectivePermissions | null | undefined): boolean {
  if (!isApprovalDeciderRole(role) || !perms) return false;
  const p = perms as EffectivePermissions;
  // WP2 (20261023040000): şube müdürü / takım lideri varsayılan matriste anlaşma için commissions:edit taşır; bu, onay
  // kararı DEMEK DEĞİL. Ofis sahibi/GM için edit yeter; diğer yönetim kademesi ancak ofis TAM komisyon yetkisi
  // (commissions:delete) verirse karar verir. DB: public.approval_actor_can_decide() aynı kural.
  if (isApprovalExemptRole(role)) return effectiveHasPermission(p, "commissions", "edit");
  return effectiveHasPermission(p, "commissions", "delete");
}

// ---------------------------------------------------------------------------------------------------------------
// ZORUNLU ONAY (WP2, sahip kararı): owner/gm dışındaki rollerde "Kazanıldı" ve komisyon paylaşımı değişikliği
// /app/onaylar'dan geçer. Ofis kontrolü kurallarından (oversight, varsayılan kapalı) BAĞIMSIZ ve her zaman açıktır.
// Talep `[oversight:<tür>:<kayıt>(:<varyant>)]` parmak izini taşır: politika otomatik onayı bu izi asla onaylamaz
// (autoApprovalReason) ve onay TEK KULLANIMLIKTIR (consumed_at).
// ---------------------------------------------------------------------------------------------------------------

export const MANDATORY_APPROVAL_ACTIONS = ["deal_won", "commission_split", "expense_claim"] as const;
export type MandatoryApprovalAction = (typeof MANDATORY_APPROVAL_ACTIONS)[number];

/** Zorunlu onay gerekir mi: yalnız owner/gm muaf (branch_manager, team_lead, accounting, advisor talep açar). */
export function needsMandatoryApproval(role: string | null | undefined): boolean {
  return !isApprovalExemptRole(role);
}

const FP_PART = /^[A-Za-z0-9_-]{1,80}$/;

/** Parmak izi (köşeli parantezsiz): `oversight:deal_won:<id>` ya da `oversight:commission_split:<id>:<özet>`. */
export function mandatoryApprovalFingerprint(action: MandatoryApprovalAction, entityId: string, variant?: string | null): string {
  if (!FP_PART.test(entityId)) throw new Error("mandatoryApprovalFingerprint: geçersiz kayıt kimliği");
  if (variant != null && !FP_PART.test(variant)) throw new Error("mandatoryApprovalFingerprint: geçersiz varyant");
  return `oversight:${action}:${entityId}${variant ? `:${variant}` : ""}`;
}

export type SplitFingerprintRow = { label?: string | null; rate: number; party?: string | null; profileId?: string | null };

/**
 * Paylaşım satırlarının SIRADAN BAĞIMSIZ kısa özeti (FNV-1a 32 bit, 8 hane). Onaylanan paylaşım ile uygulanmak istenen
 * birebir aynı olmalı: tek bir oran ya da kişi değişirse özet değişir ve yeni onay istenir.
 */
export function splitsFingerprint(rows: readonly SplitFingerprintRow[]): string {
  const canon = rows
    .map((r) => [String(r.party ?? ""), String(r.profileId ?? ""), String(r.label ?? "").trim().toLocaleLowerCase("tr-TR"), (Math.round(Number(r.rate) * 100) / 100).toFixed(2)].join("|"))
    .sort()
    .join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export type MandatoryApprovalMeta = { kind: ApprovalKind; label: string; reason: string };

/** Talep türü ve ekranda görünen gerekçe (tek kaynak). */
export const MANDATORY_APPROVAL_META: Record<MandatoryApprovalAction, MandatoryApprovalMeta> = {
  deal_won: {
    kind: "ozel_izin",
    label: "Anlaşma kazanıldı",
    reason: "Anlaşmayı Kazanıldı aşamasına almak (komisyon ve portföy kapanışı) yönetici onayı ister.",
  },
  commission_split: {
    kind: "ozel_izin",
    label: "Komisyon paylaşımı",
    reason: "Komisyon paylaşımını değiştirmek yönetici onayı ister.",
  },
  expense_claim: {
    kind: "gider",
    label: "Masraf bildirimi",
    reason: "Danışman masrafı onaylanınca ofis defterine danışmana borç (ödenecek) olarak işlenir.",
  },
};

/**
 * Onaylanan talep şimdiki işlemi kapsıyor mu (SAF): "Kazanıldı" onayı anlaşma TUTARINA bağlıdır (onaydan sonra tutar
 * değişirse yeni onay gerekir); paylaşım onayı parmak izindeki özetle bağlıdır (değer karşılaştırması yok).
 */
export function mandatoryApprovalCovers(
  action: MandatoryApprovalAction,
  approved: { requestedValue?: number | null },
  wanted: { requestedValue?: number | null },
): boolean {
  if (action !== "deal_won") return true;
  const a = approved.requestedValue;
  const w = wanted.requestedValue;
  if (a == null || w == null || !Number.isFinite(a) || !Number.isFinite(w)) return false;
  return Math.abs(a - w) < 0.005;
}

/**
 * Karar verilebilir mi — TEK kural noktası.
 *
 * Bu üç koşul (kademe / durum / kendi talebi) action içinde dağınık if'ler
 * olarak durursa biri sessizce düşebilir. En kritik olanı üçüncüsü:
 * kendi talebini onaylayan yönetici, kaydı "iz" olmaktan çıkarıp formaliteye
 * çevirir. Saf fonksiyon olduğu için birim testle kapalı
 * (`src/lib/__tests__/approvals.test.ts`).
 *
 * NOT: Bu fonksiyon `commissions:edit` modül yetkisini KONTROL ETMEZ — o kapı
 * `requirePermission` ile action'ın en başında geçilir.
 */
export function canDecide(input: {
  role: string | null | undefined;
  status: string;
  requestedBy: string | null;
  userId: string;
  /** Süresi dolmamış vekil onaylayıcı (OA12): kademe şartı aranmaz, diğer iki kural aynen geçerli. */
  delegate?: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (!input.delegate && !isApprovalDeciderRole(input.role)) {
    return { ok: false, error: "Onay/ret kararı yalnızca yönetici rolleri tarafından verilebilir." };
  }
  if (input.status !== "bekliyor") {
    return { ok: false, error: "Bu talep zaten sonuçlanmış." };
  }
  if (input.requestedBy && input.requestedBy === input.userId) {
    return { ok: false, error: "Kendi talebinizi onaylayamaz veya reddedemezsiniz." };
  }
  return { ok: true };
}

/** Yüzde biçimi: gereksiz ondalık basmaz (%3, %2,5). */
function pct(n: number): string {
  return `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n)}`;
}

/** Para biçimi: 12.000 ₺ (kuruş yok — onay ekranında gürültü). */
function money(n: number): string {
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n)} ₺`;
}

export type DeltaInfo = {
  /** Tam metin — ör. "%3 → %2 (−1 puan)" ya da "12.000 ₺ → 9.500 ₺ (−%21)". */
  text: string;
  /** Değişim yönü — satırdaki renk kararı buradan verilir. */
  direction: "artis" | "azalis" | "sabit" | "yok";
  /** Yüzdesel değişim (para/serbest değerde); sıfıra bölünme durumunda null. */
  changePct: number | null;
};

/**
 * "Mevcut → talep edilen" farkını insanca yazar.
 *
 * Neden `kind` parametresi: komisyonda fark PUAN'dır (%3'ten %2'ye düşüş "1 puan"
 * — "%33 azalış" demek yanıltıcı olurdu, sahada kimse böyle konuşmuyor).
 * Para değerlerinde ise yüzdesel değişim doğru dil.
 *
 * Sıfıra bölünme: mevcut değer 0 iken yüzde hesabı tanımsız → oran parantezi
 * yazılmaz, yön yine de doğru raporlanır.
 */
export function formatDelta(
  current: number | null | undefined,
  requested: number | null | undefined,
  kind: string,
): DeltaInfo {
  const unit = kindMeta(kind).unit;
  const fmt = unit === "yuzde" ? pct : unit === "para" ? money : (n: number) => new Intl.NumberFormat("tr-TR").format(n);

  const hasCur = typeof current === "number" && Number.isFinite(current);
  const hasReq = typeof requested === "number" && Number.isFinite(requested);

  if (!hasCur && !hasReq) return { text: "—", direction: "yok", changePct: null };
  // Tek taraf verilmişse delta yok, ama bilinen değeri göstermek yine de bilgi.
  if (!hasCur) return { text: fmt(requested as number), direction: "yok", changePct: null };
  if (!hasReq) return { text: fmt(current as number), direction: "yok", changePct: null };

  const cur = current as number;
  const req = requested as number;
  const diff = req - cur;
  const direction: DeltaInfo["direction"] = diff > 0 ? "artis" : diff < 0 ? "azalis" : "sabit";
  const head = `${fmt(cur)} → ${fmt(req)}`;

  if (diff === 0) return { text: `${head} (değişiklik yok)`, direction, changePct: 0 };

  const sign = diff > 0 ? "+" : "−";
  const abs = Math.abs(diff);

  if (unit === "yuzde") {
    // Puan farkı — yüzdenin yüzdesi değil.
    const puan = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(abs);
    const changePct = cur === 0 ? null : Math.round((diff / cur) * 100);
    return { text: `${head} (${sign}${puan} puan)`, direction, changePct };
  }

  if (cur === 0) {
    // Sıfırdan artış: "%∞" yazmak yerine mutlak farkı veriyoruz.
    return { text: `${head} (${sign}${fmt(abs)})`, direction, changePct: null };
  }

  const changePct = Math.round((diff / cur) * 100);
  return { text: `${head} (${sign}%${Math.abs(changePct)})`, direction, changePct };
}

/**
 * Karar için hedef süre (saat) — VARSAYILANLAR. Ofis kendi süresini Kurallar ve varsayılanlar > Onay politikası'ndan
 * değiştirir (`office.approvals.sla_hours.<tür>`); değiştirmedikçe bu değerler geçerlidir (tenant.test kilitler).
 *
 * Neden türe göre farklı: komisyon indirimi müşteri masasında bekliyor —
 * 24 saatte cevap gelmezse anlaşma kaçar. Gider talebi aynı aciliyette değil.
 * Bilinmeyen tür `diger` eşiğine düşer.
 */
export const DEFAULT_SLA_HOURS: Readonly<Record<ApprovalKind, number>> = {
  komisyon_indirimi: 24,
  gider: 48,
  fiyat_degisikligi: 24,
  ozel_izin: 72,
  diger: 72,
};

/**
 * Ofis onay politikası (OA12). Otomatik onay eşikleri VARSAYILAN KAPALI (0): para etkili bir karar ofis açıkça
 * istemedikçe kendiliğinden verilmez. Vekil onaylayıcı ayrı tabloda (approval_delegations) tutulur.
 */
export type ApprovalPolicy = {
  slaHours: Record<ApprovalKind, number>;
  /** Komisyon indiriminde en çok kaç PUAN düşüş otomatik onaylanır (0 = kapalı). */
  autoMaxCommissionPoints: number;
  /** Olağandışı giderde en çok kaç ₺ otomatik onaylanır (0 = kapalı). */
  autoMaxExpenseTry: number;
  /** Fiyat değişikliğinde en çok yüzde kaç İNDİRİM otomatik onaylanır (0 = kapalı). */
  autoMaxPriceDropPct: number;
};

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  slaHours: { ...DEFAULT_SLA_HOURS },
  autoMaxCommissionPoints: 0,
  autoMaxExpenseTry: 0,
  autoMaxPriceDropPct: 0,
};

export function slaHours(kind: string, policy?: Pick<ApprovalPolicy, "slaHours"> | null): number {
  const table = policy?.slaHours ?? DEFAULT_SLA_HOURS;
  const k = isApprovalKind(kind) ? kind : "diger";
  const v = table[k];
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SLA_HOURS[k];
}

/**
 * Bekleyen talep SLA'yı aştı mı.
 *
 * SINIR DAVRANIŞI: tam eşikte (24.000 saat) HENÜZ gecikmiş değildir —
 * "24 saat içinde cevapla" sözü 24. saatte tutulmuş sayılır. Kesin `>` .
 */
export function isOverdue(
  createdAt: string | number | Date,
  kind: string,
  nowMs: number,
  policy?: Pick<ApprovalPolicy, "slaHours"> | null,
): boolean {
  const started = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  if (!Number.isFinite(started)) return false;
  const elapsedH = (nowMs - started) / 3_600_000;
  return elapsedH > slaHours(kind, policy);
}

/** Ofis kontrolü kapısının açtığı talepler (parmak izli) politika ile otomatik onaylanmaz: kural zaten yönetici ister. */
const OVERSIGHT_FINGERPRINT = /^\[oversight:/i;

/**
 * Otomatik onay kararı (SAF, OA12). Eşik altındaysa gerekçe metni, değilse null. Kurallar:
 *  - yalnız komisyon indirimi, olağandışı gider ve fiyat değişikliği; özel izin / diğer hiçbir zaman;
 *  - eşik 0 ise kapalı; değer eksikse karar verilmez (tahmin yok);
 *  - komisyon: talep edilen < mevcut ve düşüş (puan) ≤ eşik; artış otomatik onaylanmaz (zaten indirim değil);
 *  - gider: talep edilen tutar (yoksa `amount`) ≤ eşik;
 *  - fiyat: yalnız İNDİRİM ve indirim yüzdesi ≤ eşik (artış ya da sabit fiyat otomatik onaylanmaz);
 *  - ofis kontrolü parmak izli talepler hiçbir zaman.
 */
export function autoApprovalReason(
  input: { kind: string; current: number | null; requested: number | null; amount: number | null; description?: string | null },
  policy: Pick<ApprovalPolicy, "autoMaxCommissionPoints" | "autoMaxExpenseTry" | "autoMaxPriceDropPct">,
): string | null {
  if (OVERSIGHT_FINGERPRINT.test(String(input.description ?? "").trim())) return null;
  const fin = (n: number | null): n is number => typeof n === "number" && Number.isFinite(n);
  const nf = (n: number, d = 2) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: d }).format(n);
  switch (input.kind) {
    case "komisyon_indirimi": {
      const max = policy.autoMaxCommissionPoints;
      if (!(max > 0) || !fin(input.current) || !fin(input.requested)) return null;
      const drop = input.current - input.requested;
      if (drop <= 0 || drop > max + 1e-9) return null;
      return `Otomatik onay (ofis politikası): ${nf(drop)} puan indirim, sınır ${nf(max)} puan.`;
    }
    case "gider": {
      const max = policy.autoMaxExpenseTry;
      const value = fin(input.requested) ? input.requested : input.amount;
      if (!(max > 0) || !fin(value) || value <= 0 || value > max) return null;
      return `Otomatik onay (ofis politikası): ${nf(value, 0)} ₺, sınır ${nf(max, 0)} ₺.`;
    }
    case "fiyat_degisikligi": {
      const max = policy.autoMaxPriceDropPct;
      if (!(max > 0) || !fin(input.current) || !fin(input.requested) || input.current <= 0) return null;
      const dropPct = ((input.current - input.requested) / input.current) * 100;
      if (dropPct <= 0 || dropPct > max + 1e-9) return null;
      return `Otomatik onay (ofis politikası): %${nf(dropPct, 1)} indirim, sınır %${nf(max, 1)}.`;
    }
    default:
      return null;
  }
}

/** Vekalet geçerli mi: bitiş günü (TR duvar günü, dahil) bugünden önce değil. `todayKey` = "YYYY-MM-DD". */
export function isDelegationActive(d: { delegate_id: string; until_on: string } | null | undefined, todayKey: string): boolean {
  return Boolean(d && d.delegate_id && /^\d{4}-\d{2}-\d{2}$/.test(d.until_on) && d.until_on >= todayKey);
}

/** Bekleme süresi metni — "3 saat bekliyor" / "2 gün bekliyor". */
export function waitingLabel(createdAt: string | number | Date, nowMs: number): string {
  const started = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  if (!Number.isFinite(started)) return "—";
  const mins = Math.max(0, Math.floor((nowMs - started) / 60_000));
  if (mins < 60) return `${mins} dk bekliyor`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saat bekliyor`;
  return `${Math.floor(hours / 24)} gün bekliyor`;
}

/** Karar süresi ortalaması (saat) — StatCard için. Kararsız satırlar hariç. */
export function averageDecisionHours(
  rows: Array<{ created_at: string; decided_at: string | null }>,
): number | null {
  const spans = rows
    .filter((r) => r.decided_at)
    .map((r) => (new Date(r.decided_at as string).getTime() - new Date(r.created_at).getTime()) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0);
  if (spans.length === 0) return null;
  return Math.round((spans.reduce((s, h) => s + h, 0) / spans.length) * 10) / 10;
}
