/**
 * EİDS aksiyon motoru — SAF çekirdek (istemci ve sunucu güvenle import eder; DB/ağ yok).
 *
 * Yetki olayından (verme / uzatma / iptal / süre bitimi) hangi görevin, hangi metinle, hangi kontrol listesiyle
 * açılacağını belirler. Yazma `actions.ts`'tedir (sunucu); burada yalnız karar ve metin vardır, birim testli.
 *
 * Dayanak: Taşınmaz Ticareti Hakkında Yönetmelik md. 14/2-h (yetkisiz ilan yasağı) ve 14/2-j (yetki sona erince ilanın
 * kaldırılması). İdari para cezası aralığı 2026 için 28.620 – 858.620 TL'dir (yılbaşında yeniden değerleme: TEK YER burası).
 */
import { DAY_MS, TR_OFFSET_MS, trDayKey } from "@/lib/clock";
import { PORTAL_LABELS } from "@/lib/portals/catalog";

export const EIDS_TASK_KINDS = ["eids_publish", "eids_takedown"] as const;
export type EidsTaskKind = (typeof EIDS_TASK_KINDS)[number];

export function isEidsTaskKind(v: unknown): v is EidsTaskKind {
  return typeof v === "string" && (EIDS_TASK_KINDS as readonly string[]).includes(v);
}

/** Ceza aralığı (2026). Yılbaşında yalnız burası güncellenir. */
export const EIDS_PENALTY_RANGE_TEXT = "28.620 – 858.620 TL";
export const EIDS_LEGAL_BASIS_TEXT = "Taşınmaz Ticareti Hakkında Yönetmelik md. 14/2-h ve 14/2-j";
/** Görev, pano ve kılavuzda aynı cümle. */
export const EIDS_LEGAL_NOTE = `${EIDS_LEGAL_BASIS_TEXT}: yetkisi olmayan ya da yetkisi sona eren taşınmazın ilanı yayında kalamaz. İdari para cezası ${EIDS_PENALTY_RANGE_TEXT}.`;

/** Kaldırma görevinin süresi (gün) ve yükseltme eşiği (saat; ayardan değişebilir). */
export const TAKEDOWN_DUE_DAYS = 3;
export const TAKEDOWN_ESCALATE_HOURS = 48;
/** "Yetki geldi, ilanı hazırla" görevinin termini (iş günü). */
export const PUBLISH_DUE_BUSINESS_DAYS = 2;

/** EmlakSoft'un kendi yüzeyleri (portal dışı kalemler). */
export const OWN_SURFACE_TARGETS = ["vitrin", "paylasim", "sosyal"] as const;
export type OwnSurfaceTarget = (typeof OWN_SURFACE_TARGETS)[number];

export const TAKEDOWN_TARGET_LABELS: Record<string, string> = {
  vitrin: "EmlakSoft vitrini",
  paylasim: "Paylaşım bağlantıları",
  sosyal: "Sosyal medya kartı / paylaşımları",
  // Portal adları katalogdan (tek kaynak); geçmiş portal da eski kalemleri göstermek için dahil.
  ...PORTAL_LABELS,
};

export function takedownTargetLabel(target: string): string {
  return TAKEDOWN_TARGET_LABELS[target] ?? target.charAt(0).toLocaleUpperCase("tr-TR") + target.slice(1);
}

export const TAKEDOWN_ITEM_STATUSES = ["pending", "removed", "not_found"] as const;
export type TakedownItemStatus = (typeof TAKEDOWN_ITEM_STATUSES)[number];
export const TAKEDOWN_ITEM_STATUS_LABELS: Record<TakedownItemStatus, string> = {
  pending: "Bekliyor",
  removed: "Kaldırıldı",
  not_found: "Yayında değildi",
};
export const TAKEDOWN_VERIFIED_LABELS: Record<string, string> = {
  extension: "eklenti doğruladı",
  manual: "elle işaretlendi",
  system: "otomatik kapatıldı",
};

export function isTakedownItemStatus(v: unknown): v is TakedownItemStatus {
  return typeof v === "string" && (TAKEDOWN_ITEM_STATUSES as readonly string[]).includes(v);
}

/** Portal adı normalleştirme (EP1 ile aynı kural: lower(trim())). */
export const normalizePortalKey = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase();

/* ------------------------------------------------------------------ */
/* Tarih                                                              */
/* ------------------------------------------------------------------ */

/**
 * `nowMs`'den itibaren `days` İŞ GÜNÜ sonrası, TR 18:00 (Cumartesi/Pazar atlanır; resmi tatil bilgisi yok).
 * Cuma 15:00 + 2 iş günü = Salı 18:00.
 */
export function addBusinessDaysMs(nowMs: number, days: number): number {
  let dayStartTr = Math.floor((nowMs + TR_OFFSET_MS) / DAY_MS) * DAY_MS; // TR gün başı (TR duvar saatinde)
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    dayStartTr += DAY_MS;
    const wd = new Date(dayStartTr).getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return dayStartTr + 18 * 3_600_000 - TR_OFFSET_MS;
}

/** Bitiş tarihi (YYYY-MM-DD) TR bugününden önce mi? */
export function isAuthorityEndPast(endDate: string | null | undefined, nowMs: number): boolean {
  if (!endDate || !/^\d{4}-\d{2}-\d{2}/.test(endDate)) return false;
  return endDate.slice(0, 10) < trDayKey(nowMs);
}

/* ------------------------------------------------------------------ */
/* Olay → karar                                                       */
/* ------------------------------------------------------------------ */

/** EP2 defter satırının (eids_authority_events) bu motorun okuduğu alt kümesi. */
export type AuthorityEventInput = {
  id: string;
  tenant_id: string;
  property_id: string | null;
  kind: string;
  source?: string | null;
  valid_until?: string | null;
  prev_status?: string | null;
  new_status?: string | null;
  created_at?: string | null;
};

export type TakedownCause = { kind: "revoke"; eventId: string } | { kind: "expire"; endDate: string };

export type EventDecision =
  | { action: "publish_or_note" }
  | { action: "takedown"; cause: TakedownCause }
  | { action: "extend" }
  | { action: "undo_takedown" }
  | { action: "none"; reason: string };

const REVOKED_STATES = new Set(["revoked", "expired"]);

/**
 * Motorun işlediği defter türleri (EP2 `eids_authority_events.kind` kümesinin tamamı). `link` = Eşleştir kuyruğundan
 * adayla bağlanan bildirim (yeni durum `new_status`'ta: approved ya da revoked), `override` = sahibin aktarım izni.
 */
export const EIDS_ACTIONABLE_EVENT_KINDS = ["grant", "extend", "revoke", "expire", "undo", "manual_set", "link", "override"] as const;

export function decideForEvent(ev: AuthorityEventInput): EventDecision {
  if (!ev.property_id) return { action: "none", reason: "eslesmemis" };
  switch (ev.kind) {
    case "grant":
      return { action: "publish_or_note" };
    case "extend":
      return { action: "extend" };
    case "revoke":
      return { action: "takedown", cause: { kind: "revoke", eventId: ev.id } };
    case "expire": {
      const end = (ev.valid_until ?? "").slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(end) ? { action: "takedown", cause: { kind: "expire", endDate: end } } : { action: "takedown", cause: { kind: "revoke", eventId: ev.id } };
    }
    case "undo":
    case "manual_set":
    case "link":
    case "override":
      // Durum geçişinden karar: geri alma / elle düzeltme / bağlama yetkiyi yeniden geçerli kıldıysa açık kaldırma görevi
      // iptal edilir, yüzeyler geri açılır; iptal/süre bitimine geçtiyse kaldırma görevi açılır.
      if (ev.prev_status && REVOKED_STATES.has(ev.prev_status) && ev.new_status && !REVOKED_STATES.has(ev.new_status)) return { action: "undo_takedown" };
      if (ev.new_status && REVOKED_STATES.has(ev.new_status)) return { action: "takedown", cause: { kind: "revoke", eventId: ev.id } };
      // Eşleştir kuyruğundan bağlanan "yetki verildi" bildirimi = verme olayı (yayın görevi ya da bilgi notu).
      if ((ev.kind === "link" || ev.kind === "override") && ev.new_status === "approved" && ev.prev_status !== "approved") return { action: "publish_or_note" };
      return { action: "none", reason: "durum_degismedi" };
    default:
      return { action: "none", reason: "bilinmeyen_tur" };
  }
}

/** Aynı olay için ikinci görev açılmaz: tekil anahtar (tasks.dedupe_key). */
export function takedownDedupeKey(propertyId: string, cause: TakedownCause): string {
  return cause.kind === "revoke" ? `eids:takedown:${propertyId}:revoke:${cause.eventId}` : `eids:takedown:${propertyId}:expire:${cause.endDate}`;
}

export function publishDedupeKey(propertyId: string, validUntil: string | null | undefined, eventId: string): string {
  const end = (validUntil ?? "").slice(0, 10);
  return `eids:publish:${propertyId}:${/^\d{4}-\d{2}-\d{2}$/.test(end) ? end : eventId}`;
}

/* ------------------------------------------------------------------ */
/* Metinler                                                           */
/* ------------------------------------------------------------------ */

const fmtDate = (iso: string | null | undefined): string => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join(".") : "");

export function propertyLabel(p: { property_code?: string | null; title?: string | null }): string {
  return [p.property_code, p.title].filter((v) => (v ?? "").trim()).join(" · ").slice(0, 120) || "Portföy";
}

export function takedownTaskText(input: { label: string; cause: TakedownCause }): { title: string; notes: string } {
  const why =
    input.cause.kind === "expire"
      ? `Yetki süresi ${fmtDate(input.cause.endDate)} tarihinde doldu ve uzatma kaydı yok.`
      : "Mal sahibi EİDS yetkisini iptal etti.";
  return {
    title: `ACİL: 3 gün içinde ilanı kaldır — ${input.label}`.slice(0, 200),
    notes: [
      why,
      `Yapılacak: aşağıdaki kontrol listesindeki her yerde ilanı yayından kaldırın ve işaretleyin. Tüm kalemler işaretlenmeden görev kapanmaz.`,
      EIDS_LEGAL_NOTE,
    ].join("\n"),
  };
}

export function publishTaskText(input: { label: string; validUntil: string | null | undefined }): { title: string; notes: string } {
  const end = fmtDate(input.validUntil);
  return {
    title: `İlanı hazırla/yayınla — EİDS yetkisi geldi: ${input.label}`.slice(0, 200),
    notes: `Mal sahibi e-Devlet'te EİDS yetkisi verdi${end ? ` (bitiş ${end})` : ""}. Fotoğraf, fiyat ve açıklamayı tamamlayıp ilanı portallara çıkarın. Bitişten 30, 15, 7 ve 3 gün önce hatırlatma gelir.`,
  };
}

/**
 * Malikten teyit isteme metni (SMS/WhatsApp/e-posta ortak; işlem hatırlatması, reklam içermez). Malikten e-Devlet
 * "EİDS Yetki İşlemleri" ekranının görüntüsünü ister: e-posta gelmeyen durumda yetkiyi belgelemenin yolu budur.
 */
export function ownerConfirmRequestText(input: { ownerName?: string | null; office?: string | null; propertyLabel: string; eidsNo?: string | null }): string {
  const hello = input.ownerName?.trim() ? `Sayın ${input.ownerName.trim()}, ` : "Merhaba, ";
  const office = input.office?.trim() ? `${input.office.trim()} olarak ` : "";
  const no = input.eidsNo?.trim() ? ` (taşınmaz no ${input.eidsNo.trim()})` : "";
  const text = `${hello}${office}${input.propertyLabel}${no} için verdiğiniz ilan yetkisinin güncel durumunu teyit etmek istiyoruz. e-Devlet'te "EİDS Yetki İşlemleri" ekranını açıp yetkinin göründüğü sayfanın ekran görüntüsünü bize iletebilir misiniz? Teşekkür ederiz.`;
  return text.length > 460 ? `${text.slice(0, 459)}…` : text;
}

/* ------------------------------------------------------------------ */
/* Kontrol listesi                                                    */
/* ------------------------------------------------------------------ */

export type LiveListing = { id: string; portal_name: string | null };
export type PlannedItem = { target: string; portal_listing_id: string | null };

/**
 * Kaldırma kontrol listesi: ofisin AKTİF üyeliği olan portallardaki canlı portal_listings kayıtları + EmlakSoft
 * vitrini + paylaşım bağlantıları + sosyal kart. `activePortals === null` = üyelik bilgisi henüz yok (EP1 tablosu kurulmamış):
 * güvenli taraf, tüm canlı kayıtlar listeye girer.
 */
export function planTakedownItems(input: { liveListings: readonly LiveListing[]; activePortals: ReadonlySet<string> | null }): PlannedItem[] {
  const out: PlannedItem[] = [];
  const seen = new Set<string>();
  for (const l of input.liveListings) {
    const key = normalizePortalKey(l.portal_name);
    if (!key) continue;
    if (input.activePortals && !input.activePortals.has(key)) continue;
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push({ target: key, portal_listing_id: l.id });
  }
  out.sort((a, b) => a.target.localeCompare(b.target, "tr"));
  for (const t of OWN_SURFACE_TARGETS) out.push({ target: t, portal_listing_id: null });
  return out;
}

/** Görev kapanabilir mi? (DB tetiği aynı kuralı uygular; ekran düğmeyi buna göre açar.) */
export function canCloseTakedown(items: readonly { status: string }[]): boolean {
  return items.length > 0 && items.every((i) => i.status !== "pending");
}

/** 48 saat (ayar) dolmuş, açık ve henüz yükseltilmemiş kaldırma görevi. */
export function shouldEscalate(task: { status: string; created_at: string; escalated_at: string | null }, nowMs: number, hours = TAKEDOWN_ESCALATE_HOURS): boolean {
  if (task.status !== "open" || task.escalated_at) return false;
  const created = Date.parse(task.created_at);
  return Number.isFinite(created) && nowMs - created >= hours * 3_600_000;
}

/* ------------------------------------------------------------------ */
/* İletme (alma adresi) durumu                                        */
/* ------------------------------------------------------------------ */

/** Eşleştir kuyruğu (EP3 `eids_inbound_messages.match_status`; İlan Kontrol > Yetki > Eşleştir sekmesiyle AYNI küme). */
export const EIDS_MATCH_QUEUE_STATUSES = ["queued", "candidate", "no_match"] as const;

export type ForwardingState = "bagli" | "sessiz" | "kurulmadi";
export const FORWARDING_LABELS: Record<ForwardingState, string> = { bagli: "Bağlı", sessiz: "Sessiz", kurulmadi: "Kurulmadı" };
export const MAIL_SILENT_DAYS = 90;

/** Aktif alma adresi yoksa "kurulmadı"; adres var ama 90 gündür (ya da kurulduğundan beri 90+ gün) e-posta yoksa "sessiz". */
export function forwardingState(addr: { created_at: string; last_received_at: string | null } | null, nowMs: number): ForwardingState {
  if (!addr) return "kurulmadi";
  const last = Date.parse(addr.last_received_at ?? addr.created_at);
  if (!Number.isFinite(last)) return "kurulmadi";
  return nowMs - last >= MAIL_SILENT_DAYS * DAY_MS ? "sessiz" : "bagli";
}

/* ------------------------------------------------------------------ */
/* Yetki uyum raporu (aylık)                                          */
/* ------------------------------------------------------------------ */

export type ComplianceTask = { id: string; created_at: string; completed_at: string | null; status: string; assigned_to: string | null };
export type ComplianceReport = {
  takedownCount: number;
  closedCount: number;
  /** Kapananların ortalama kaldırma süresi (saat); kapanan yoksa null. */
  avgRemovalHours: number | null;
  /** 3 günü aşan kaldırmalar (kapanmış ve geç kapanmış + açık ve süresi geçmiş). */
  lateCount: number;
  /** Kapsamdaki portföylerde e-posta ile teyitli oranı (%), payda 0 ise null. */
  emailVerifiedPct: number | null;
  /** Bilinmeyen yetki oranı (%), payda 0 ise null. */
  unknownPct: number | null;
  /** 0-100 puan (karne bileşeni); hiç veri yoksa null. */
  score: number | null;
};

export function computeComplianceReport(input: {
  tasks: readonly ComplianceTask[];
  portfolio: { total: number; emailVerified: number; unknown: number } | null;
  nowMs: number;
}): ComplianceReport {
  const limitMs = TAKEDOWN_DUE_DAYS * DAY_MS;
  let closed = 0;
  let sumMs = 0;
  let late = 0;
  for (const t of input.tasks) {
    const created = Date.parse(t.created_at);
    if (!Number.isFinite(created)) continue;
    if (t.status === "done" && t.completed_at) {
      const done = Date.parse(t.completed_at);
      if (!Number.isFinite(done)) continue;
      closed += 1;
      sumMs += Math.max(0, done - created);
      if (done - created > limitMs) late += 1;
    } else if (t.status === "open" && input.nowMs - created > limitMs) {
      late += 1;
    }
  }
  const p = input.portfolio;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
  const emailVerifiedPct = p ? pct(p.emailVerified, p.total) : null;
  const unknownPct = p ? pct(p.unknown, p.total) : null;
  const removalCount = input.tasks.length;
  // Puan: kaldırmaların zamanında olma oranı (%60) + bilinen yetki oranı (%40). Bileşen verisi yoksa ağırlığı düşer.
  const parts: { w: number; v: number }[] = [];
  if (removalCount > 0) parts.push({ w: 0.6, v: 100 * (1 - late / removalCount) });
  if (unknownPct !== null) parts.push({ w: 0.4, v: 100 - unknownPct });
  const wSum = parts.reduce((s, x) => s + x.w, 0);
  const score = wSum > 0 ? Math.round(parts.reduce((s, x) => s + x.w * x.v, 0) / wSum) : null;
  return {
    takedownCount: removalCount,
    closedCount: closed,
    avgRemovalHours: closed > 0 ? Math.round((sumMs / closed / 3_600_000) * 10) / 10 : null,
    lateCount: late,
    emailVerifiedPct,
    unknownPct,
    score,
  };
}

/** ISO hafta anahtarı (haftalık özet tekilliği): "2026-W42". TR gününe göre. */
export function trIsoWeekKey(nowMs: number): string {
  const d = new Date(Date.parse(`${trDayKey(nowMs)}T00:00:00Z`));
  const wd = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - wd);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Platform yönetimi: maskeli örnek                                   */
/* ------------------------------------------------------------------ */

/**
 * Platform yöneticisine gösterilen örnek metnin İKİNCİ maskesi (EP3 örneği zaten maskeli saklar; burada savunma derinliği):
 * "… konusunda <ad> tarafından …" kalıbındaki malik adı tamamen gizlenir, 6+ haneli numaralar son 3 hane dışında
 * yıldızlanır, e-posta adresleri gizlenir. Admin malik adını hiçbir koşulda görmez.
 */
export function maskSampleForAdmin(text: string | null | undefined, max = 400): string {
  if (!text) return "";
  return text
    .replace(/(konusunda\s+)([\s\S]+?)(\s+tarafından)/giu, "$1***$3")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "***@***")
    .replace(/\d{6,}/g, (m) => `${"*".repeat(m.length - 3)}${m.slice(-3)}`)
    .slice(0, max);
}
