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

/**
 * Karar verebilen roller.
 *
 * `src/lib/permissions.ts` matrisinden okundu: yönetim kademesi owner / gm /
 * branch_manager / team_lead. `accounting` komisyonda tam CRUD'a sahip ama
 * KADEMESİ yönetici değil — hakediş kaydını işler, indirim politikasına karar
 * vermez; bu yüzden listede yok. Yetki kapısı ayrıca `commissions:edit` ister,
 * yani rol listesi TEK başına yetmez (bkz. actions/approvals.ts).
 */
export const MANAGER_ROLES = ["owner", "gm", "branch_manager", "team_lead"] as const;

export function isManagerRole(role: string | null | undefined): boolean {
  return (MANAGER_ROLES as readonly string[]).includes(String(role ?? ""));
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
}): { ok: true } | { ok: false; error: string } {
  if (!isManagerRole(input.role)) {
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
 * Karar için hedef süre (saat).
 *
 * Neden türe göre farklı: komisyon indirimi müşteri masasında bekliyor —
 * 24 saatte cevap gelmezse anlaşma kaçar. Gider talebi aynı aciliyette değil.
 * Bilinmeyen tür `diger` eşiğine düşer.
 */
const SLA_HOURS: Record<ApprovalKind, number> = {
  komisyon_indirimi: 24,
  gider: 48,
  fiyat_degisikligi: 24,
  ozel_izin: 72,
  diger: 72,
};

export function slaHours(kind: string): number {
  return SLA_HOURS[kind as ApprovalKind] ?? SLA_HOURS.diger;
}

/**
 * Bekleyen talep SLA'yı aştı mı.
 *
 * SINIR DAVRANIŞI: tam eşikte (24.000 saat) HENÜZ gecikmiş değildir —
 * "24 saat içinde cevapla" sözü 24. saatte tutulmuş sayılır. Kesin `>` .
 */
export function isOverdue(createdAt: string | number | Date, kind: string, nowMs: number): boolean {
  const started = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  if (!Number.isFinite(started)) return false;
  const elapsedH = (nowMs - started) / 3_600_000;
  return elapsedH > slaHours(kind);
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
