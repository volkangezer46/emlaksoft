/**
 * Personel izinleri (`staff_leaves`) — saf yardımcılar.
 *
 * SAF MODÜL: burada `Date.now()` YOK. Tüm karşılaştırmalar çağıranın verdiği
 * tarih/aralık üzerinden yapılır (bkz. `src/lib/clock.ts` saflık kuralı ve
 * `booking-slots.ts` deseni) — böylece hem React Compiler'a uyar hem de birim
 * testi deterministik olur (`__tests__/leave-utils.test.ts`).
 *
 * TARİH MODELİ: `starts_on` / `ends_on` DATE'tir ve İKİ UÇ DA DAHİLDİR.
 * 14-14 tek günlük izindir. Saat bilgisi yoktur — izin gün bloklar.
 *
 * SAAT DİLİMİ: izin günü ofisin DUVAR günüdür. Busy aralığa çevirirken günün
 * 00:00–24:00'ü TR duvar saatinde alınır ve `tzOffsetMin` (TR için 180) ile
 * UTC epoch ms'e taşınır — booking-slots'un `BusyInterval` sözleşmesi bu.
 *
 * BLOKLAMA KURALI: yalnız `status = 'onayli'` izin engel sayılır. 'talep'
 * (onay bekliyor) ve 'reddedildi' takvimde görünür ama slot KAPATMAZ — aksi
 * halde reddedilmiş bir talep müşterinin randevu almasını engellerdi.
 */

const DAY_MS = 86_400_000;

/** İzin türü — DB check kısıtıyla birebir. */
export type LeaveKind = "izin" | "rapor" | "egitim" | "resmi_tatil" | "diger";

/** Onay durumu — yalnız 'onayli' bloklar. */
export type LeaveStatus = "talep" | "onayli" | "reddedildi";

/**
 * Hesaplama için gereken en dar izin şekli. Sayfa/action tarafındaki satırlar
 * (ad, not, id gibi ek alanlarla) bu tipe yapısal olarak uyar.
 */
export type LeaveLike = {
  staff_id: string;
  /** "YYYY-MM-DD" (dahil). */
  starts_on: string;
  /** "YYYY-MM-DD" (DAHİL). */
  ends_on: string;
  status?: string | null;
  kind?: string | null;
};

/** Aralık — booking-slots `BusyInterval` ile aynı şekil (epoch ms). */
export type LeaveBusyInterval = { start: number; end: number };

/** "YYYY-MM-DD" biçiminde mi (kaba doğrulama — DB zaten date tipinde tutar). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Sadece 'onayli' izinler bloklar; diğer durumlar takvimde görünür ama engel değildir. */
function blocks(leave: LeaveLike): boolean {
  return (leave.status ?? "onayli") === "onayli";
}

/**
 * Tarih anahtarını (ISO tarih ya da tam ISO zaman damgası) "YYYY-MM-DD"ye indirir.
 * Bozuk girdi için null döner — çağıran tarafta sessizce elenir.
 */
export function toDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const head = value.slice(0, 10);
  if (!DATE_RE.test(head)) return null;
  return head;
}

/**
 * `dateIso` günü, `staffId`'nin ONAYLI bir izin aralığına düşüyor mu?
 * Sınır günler dahildir. `dateIso` tam zaman damgası da olabilir (ilk 10 karakter alınır).
 */
export function isOnLeave(
  leaves: LeaveLike[] | null | undefined,
  staffId: string,
  dateIso: string,
): boolean {
  const day = toDateKey(dateIso);
  if (!day || !staffId) return false;
  return (leaves ?? []).some(
    (l) =>
      l.staff_id === staffId &&
      blocks(l) &&
      // Tarih anahtarları sabit genişlikte olduğu için sözlüksel karşılaştırma
      // kronolojik karşılaştırmaya eşittir — Date nesnesi kurmaya gerek yok.
      l.starts_on <= day &&
      day <= l.ends_on,
  );
}

/**
 * Onaylı izinleri booking-slots'un beklediği dolu aralıklara çevirir.
 * Her izin TEK bir blok olur: ilk günün 00:00'ından son günün ertesi 00:00'ına
 * kadar (bitiş günü dahil) — o günlerde hiçbir slot açılmaz.
 *
 * `staffId` verilirse yalnız o kişinin izinleri çevrilir (public randevu sayfası
 * tek danışman için sorar); verilmezse listedeki tüm onaylı izinler çevrilir.
 */
export function leaveRangesToBusy(
  leaves: LeaveLike[] | null | undefined,
  tzOffsetMin: number,
  staffId?: string,
): LeaveBusyInterval[] {
  const offsetMs = tzOffsetMin * 60_000;
  const out: LeaveBusyInterval[] = [];
  for (const l of leaves ?? []) {
    if (!blocks(l)) continue;
    if (staffId && l.staff_id !== staffId) continue;
    const s = toDateKey(l.starts_on);
    const e = toDateKey(l.ends_on);
    if (!s || !e) continue;
    const start = Date.parse(`${s}T00:00:00.000Z`) - offsetMs;
    // ends_on DAHİL → bitiş, o günün ertesinin 00:00'ı.
    const end = Date.parse(`${e}T00:00:00.000Z`) - offsetMs + DAY_MS;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    out.push({ start, end });
  }
  return out;
}

/**
 * `startIso`–`endIso` penceresiyle (gün bazında, iki uç dahil) kesişen izinler.
 * Durum FİLTRELENMEZ: çakışma uyarısı ekranı 'talep' halindeki izni de göstermeli.
 * `staffId` verilirse yalnız o kişininkiler.
 */
export function overlappingLeaves<T extends LeaveLike>(
  leaves: T[] | null | undefined,
  startIso: string,
  endIso: string,
  staffId?: string,
): T[] {
  const from = toDateKey(startIso);
  const to = toDateKey(endIso);
  if (!from || !to) return [];
  // Ters verilen pencereyi düzelt — çağıran hatası boş sonuçla gizlenmesin.
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  return (leaves ?? []).filter(
    (l) => (!staffId || l.staff_id === staffId) && l.starts_on <= hi && lo <= l.ends_on,
  );
}

/**
 * İzin kaç gün sürüyor (iki uç dahil). Tek günlük izin 1 döner.
 * Bozuk/ters tarihte 0 döner (UI "0 gün" yerine kaydı zaten göstermez).
 */
export function leaveDaysCount(startsOn: string, endsOn: string): number {
  const s = toDateKey(startsOn);
  const e = toDateKey(endsOn);
  if (!s || !e) return 0;
  const a = Date.parse(`${s}T00:00:00.000Z`);
  const b = Date.parse(`${e}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / DAY_MS) + 1;
}

/** UI etiketleri — izin türü. */
export const LEAVE_KIND_LABELS: Record<LeaveKind, string> = {
  izin: "Yıllık izin",
  rapor: "Rapor",
  egitim: "Eğitim",
  resmi_tatil: "Resmî tatil",
  diger: "Diğer",
};

/** UI rozet renkleri — izin=amber, rapor=kırmızı, eğitim=marka, resmî tatil=gri. */
export const LEAVE_KIND_TONES: Record<LeaveKind, string> = {
  izin: "bg-amber-400/15 text-amber-600",
  rapor: "bg-danger-500/10 text-danger-500",
  egitim: "bg-brand-600/10 text-brand-600",
  resmi_tatil: "bg-ink-950/8 text-text-muted",
  diger: "bg-cyan-400/12 text-cyan-600",
};

/** UI etiketleri — onay durumu. */
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  talep: "Onay bekliyor",
  onayli: "Onaylı",
  reddedildi: "Reddedildi",
};

export const LEAVE_STATUS_TONES: Record<LeaveStatus, string> = {
  talep: "bg-warn-500/10 text-warn-500",
  onayli: "bg-mint-500/10 text-mint-600",
  reddedildi: "bg-ink-950/8 text-text-muted",
};

/** Bilinmeyen değeri güvenli türe indirger (DB check'i garanti olsa da UI okuması savunmacı). */
export function asLeaveKind(value: unknown): LeaveKind {
  const v = String(value ?? "");
  return v === "rapor" || v === "egitim" || v === "resmi_tatil" || v === "diger" ? v : "izin";
}

export function asLeaveStatus(value: unknown): LeaveStatus {
  const v = String(value ?? "");
  return v === "talep" || v === "reddedildi" ? v : "onayli";
}
