/**
 * KURUMSAL ANA EKRAN — SAF hesaplar (DB'ye ve React'e bağımlı değil; vitest kapsamında: core.test.ts).
 * Para tam TL ve ₺ önekiyle (Mn/Mr/bin kısaltması yok); tarih/saat Türkiye saatine göre (`clock.ts`).
 */
import { DAY_MS, TR_OFFSET_MS, formatTrTime, trDayKey, trParts } from "@/lib/clock";
import { LISTING_CONFIRM_STALE_DAYS, confirmationAgeDays, type ConfirmableListing } from "@/lib/listing-confirmation";
import { AVG_DAYS_EMPTY_NOTE, averageDays, trendOf, type Trend } from "@/lib/trend";
import { effectivePresence, presenceRank, type PresenceRow, type PresenceStatus } from "@/lib/presence";
import { roleLabel } from "@/lib/role-labels";

export type SalesRange = "ay" | "6ay" | "yil";
export const SALES_RANGES: readonly { key: SalesRange; label: string }[] = [
  { key: "ay", label: "Bu ay" },
  { key: "6ay", label: "Son 6 ay" },
  { key: "yil", label: "Bu yıl" },
];
export type SalesFilter = { tur?: "satilik" | "kiralik"; danisman?: string };
export type SalesRow = { value: number; createdAt: string | null; closedAt: string | null };

export function parseSalesRange(raw: string | undefined): SalesRange {
  return raw === "6ay" || raw === "yil" ? raw : "ay";
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseSalesFilter(tur: string | undefined, danisman: string | undefined): SalesFilter {
  return {
    ...(tur === "satilik" || tur === "kiralik" ? { tur } : {}),
    ...(danisman && UUID.test(danisman) ? { danisman } : {}),
  };
}

export const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export const MONTHS_LONG = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

const trMid = (y: number, m: number, d: number) => Date.UTC(y, m, d) - TR_OFFSET_MS;

/** Dönemin [başlangıç, bitiş) anları + bir önceki eş uzunluktaki dönem. */
export function salesWindow(range: SalesRange, nowMs: number): { cur: [number, number]; prev: [number, number] } {
  const p = trParts(nowMs);
  if (range === "ay") {
    const start = trMid(p.year, p.month, 1);
    const prevStart = trMid(p.year, p.month - 1, 1);
    // Geçen ayın AYNI gününe kadar (ay ortasında adil karşılaştırma).
    const prevEnd = Math.min(start, prevStart + (nowMs - start));
    return { cur: [start, nowMs], prev: [prevStart, prevEnd] };
  }
  if (range === "6ay") {
    const start = trMid(p.year, p.month - 5, 1);
    return { cur: [start, nowMs], prev: [trMid(p.year, p.month - 11, 1), start] };
  }
  const start = trMid(p.year, 0, 1);
  const prevStart = trMid(p.year - 1, 0, 1);
  return { cur: [start, nowMs], prev: [prevStart, prevStart + (nowMs - start)] };
}

const closeMs = (r: SalesRow) => (r.closedAt ? Date.parse(r.closedAt) : NaN);
const inWin = (ms: number, [a, b]: [number, number]) => Number.isFinite(ms) && ms >= a && ms < b;

export type Delta = Trend | null;

/**
 * Değişim rozeti: tek kural `@/lib/trend` (önceki 0 → "yeni", ≥3 kat → "x kat", yüzde yalnız anlamlı tabanda).
 * `invert`: azalış iyidir (ör. satış süresi).
 */
export function deltaOf(cur: number, prev: number, invert = false): Delta {
  return trendOf(cur, prev, { invert });
}

export function salesSummary(rows: readonly SalesRow[], range: SalesRange, nowMs: number) {
  const w = salesWindow(range, nowMs);
  const cur = rows.filter((r) => inWin(closeMs(r), w.cur));
  const prev = rows.filter((r) => inWin(closeMs(r), w.prev));
  const total = (xs: SalesRow[]) => xs.reduce((s, r) => s + r.value, 0);
  // Süre yalnız açılış < kapanış olan satışlardan; ortalama 1 günün altındaysa null ("0 gün ↘%100" yazılmaz).
  const avgDays = (xs: SalesRow[]) => averageDays(xs.map((r) => ({ start: r.createdAt, end: r.closedAt })), DAY_MS);
  const curAvg = avgDays(cur);
  const prevAvg = avgDays(prev);
  return {
    total: total(cur),
    totalDelta: deltaOf(total(cur), total(prev)),
    count: cur.length,
    countDelta: deltaOf(cur.length, prev.length),
    avgDays: curAvg,
    /** `avgDays` null iken kartta "—" yanında gösterilecek açıklama. */
    avgNote: curAvg == null ? AVG_DAYS_EMPTY_NOTE : null,
    avgDelta: curAvg != null && prevAvg != null ? deltaOf(curAvg, prevAvg, true) : null,
  };
}

/**
 * Grafik serisi — HER dönemde kova toplamı (birikimli DEĞİL; eski "Bu ay" günlük birikimli seri tek satışta merdiven
 * çiziyordu ve "Son 6 ay"/"Bu yıl" aylık kovalarla tutarsızdı): "Bu ay" haftalık kova (1–7, 8–14, …, bugüne kadar),
 * "Son 6 ay" ve "Bu yıl" aylık toplam.
 */
export function salesSeries(rows: readonly SalesRow[], range: SalesRange, nowMs: number): { label: string; value: number }[] {
  const sumIn = (win: [number, number]) => rows.filter((r) => inWin(closeMs(r), win)).reduce((s, r) => s + r.value, 0);
  return salesSeriesWindows(range, nowMs).map(({ label, win }) => ({ label, value: sumIn(win) }));
}

/** Seri kovalarının [a, b) pencereleri (salesSeries ve SQL `home_sales_windows` AYNI pencereleri kullanır). */
export function salesSeriesWindows(range: SalesRange, nowMs: number): { label: string; win: [number, number] }[] {
  const p = trParts(nowMs);
  if (range === "ay") {
    const out: { label: string; win: [number, number] }[] = [];
    const mon = MONTHS_SHORT[p.month];
    for (let d = 1; d <= p.day; d += 7) {
      const last = Math.min(d + 6, p.day);
      const a = trMid(p.year, p.month, d);
      const b = Math.min(trMid(p.year, p.month, last + 1), nowMs + 1);
      out.push({ label: d === last ? `${d} ${mon}` : `${d}–${last} ${mon}`, win: [a, b] });
    }
    return out;
  }
  const months = range === "6ay" ? 6 : p.month + 1;
  const firstMonth = range === "6ay" ? p.month - 5 : 0;
  return Array.from({ length: months }, (_, i) => {
    const m = firstMonth + i;
    const mm = ((m % 12) + 12) % 12;
    return { label: MONTHS_SHORT[mm]!, win: [trMid(p.year, m, 1), trMid(p.year, m + 1, 1)] as [number, number] };
  });
}

/** `days` günlük kova (başlangıç anından itibaren). */
export function dailyBuckets(dates: readonly (string | null)[], startMs: number, days: number): number[] {
  const out = Array.from({ length: days }, () => 0);
  for (const iso of dates) {
    if (!iso) continue;
    const i = Math.floor((Date.parse(iso) - startMs) / DAY_MS);
    if (i >= 0 && i < days) out[i]! += 1;
  }
  return out;
}

/* ------------------------------ İlan kartı ------------------------------ */

export type ListingBadge = { label: "Fırsat" | "Yeni" | "Öne çıkan"; tone: "gold" | "brand" | "violet"; hint: string } | null;
export type ListingCard = {
  id: string;
  title: string;
  district: string | null;
  sqm: number | null;
  rooms: string | null;
  price: number | null;
  currency: string;
  transaction: string | null;
  coverSrc: string | null;
  badge: ListingBadge;
};

/**
 * Rozet VERİDEN türetilir (uydurma yok), öncelik sırasıyla: son 30 günde fiyatı düştü → "Fırsat"; son 7 günde eklendi →
 * "Yeni"; hem vitrinde hem portalda canlı → "Öne çıkan". Hiçbiri değilse rozet yok.
 */
export function listingBadge(i: { priceDropped: boolean; createdAt: string | null; published: boolean; live: boolean }, nowMs: number): ListingBadge {
  if (i.priceDropped) return { label: "Fırsat", tone: "gold", hint: "Son 30 günde fiyatı düştü" };
  if (i.createdAt && nowMs - Date.parse(i.createdAt) <= 7 * DAY_MS) return { label: "Yeni", tone: "brand", hint: "Son 7 günde eklendi" };
  if (i.published && i.live) return { label: "Öne çıkan", tone: "violet", hint: "Vitrinde ve portalda yayında" };
  return null;
}

export function transactionLabel(t: string | null): string | null {
  if (t === "sale") return "Satılık";
  if (t === "rent") return "Kiralık";
  return null;
}

/** Tam TL, ₺ önekli (kısaltma yok). Döviz portföyünde kendi simgesi. */
export function priceText(price: number | null, currency = "TRY"): string {
  if (price == null || !Number.isFinite(price)) return "Fiyat girilmedi";
  const cur = /^[A-Z]{3}$/.test(currency) ? currency : "TRY";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(price);
}

/* ------------------------------ Görevler ------------------------------ */

export type TaskCard = {
  id: string;
  title: string;
  dueAt: string | null;
  high: boolean;
  assignee: { name: string; avatarUrl: string | null; avatarPreset: string | null } | null;
};

/** Vade çipi: "3 gün gecikti" (kırmızı) · "Bugün" · "Yarın" · hafta günü · "12 Kas". */
export function dueChip(dueAt: string | null, nowMs: number): { label: string; tone: "danger" | "brand" | "neutral" } {
  if (!dueAt) return { label: "Vadesiz", tone: "neutral" };
  const due = Date.parse(dueAt);
  const p = trParts(nowMs);
  const today = trMid(p.year, p.month, p.day);
  const diff = Math.floor((due - today) / DAY_MS);
  if (diff < 0) return { label: due < nowMs && diff === -1 ? "Dün" : `${Math.abs(diff)} gün gecikti`, tone: "danger" };
  if (diff === 0) return { label: "Bugün", tone: due < nowMs ? "danger" : "brand" };
  if (diff === 1) return { label: "Yarın", tone: "neutral" };
  const dp = trParts(due);
  if (diff < 7) return { label: WEEKDAYS[dp.weekday]!, tone: "neutral" };
  return { label: `${dp.day} ${MONTHS_SHORT[dp.month]}`, tone: "neutral" };
}

/* ------------------------------ Randevu zaman çizelgesi ------------------------------ */

export type ApptStatus = { label: string; tone: "success" | "warn" | "brand" | "neutral" | "danger" };

/**
 * Randevu durum hapı (DB durumları: pending, confirmed, signature, completed, cancelled): tamamlandı · onaylandı ·
 * imza bekliyor · saati yaklaşıyor (≤60 dk) · saati geçti · planlandı (henüz teyit edilmedi).
 */
export function apptStatus(status: string | null, scheduledAt: string, nowMs: number): ApptStatus {
  if (status === "completed") return { label: "Tamamlandı", tone: "success" };
  if (status === "cancelled") return { label: "İptal", tone: "neutral" };
  const t = Date.parse(scheduledAt);
  if (Number.isFinite(t) && t >= nowMs && t - nowMs <= 60 * 60_000) return { label: "Yaklaşıyor", tone: "warn" };
  if (Number.isFinite(t) && t < nowMs) return { label: "Saati geçti", tone: "danger" };
  if (status === "confirmed") return { label: "Onaylandı", tone: "success" };
  if (status === "signature") return { label: "İmza bekliyor", tone: "brand" };
  return { label: "Planlandı", tone: "brand" };
}

/* ------------------------------ Kahraman özeti ------------------------------ */

/**
 * Kahramanın canlı özet cümlesi (resmi Türkçe, gerçek veriden): "Bugün 5 randevunuz, 3 yeni müşteri talebiniz ve 12 ilan
 * güncellemesi bekliyor." Bilinmeyen (null) ya da sıfır kalemler cümleye girmez; hiçbiri yoksa sakin bir cümle.
 */
export function heroSentence(i: { appointments: number | null; demands: number | null; listingUpdates: number | null; mine: boolean }): string {
  const parts: string[] = [];
  if (i.appointments) parts.push(`${i.appointments} randevu${i.mine ? "nuz" : ""}`);
  if (i.demands) parts.push(`${i.demands} yeni müşteri talebi${i.mine ? "niz" : ""}`);
  if (i.listingUpdates) parts.push(`${i.listingUpdates} ilan güncellemesi`);
  if (parts.length === 0) return "Bugün için bekleyen acil bir iş görünmüyor; yeni kayıtlarla güne başlayabilirsiniz.";
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} ve ${parts.at(-1)}`;
  return `Bugün ${list} ${parts.length === 1 ? "bekliyor" : "sizi bekliyor"}.`;
}

/** "16 Ekim 2026, Cuma" */
export function longDate(nowMs: number): string {
  const p = trParts(nowMs);
  return `${p.day} ${MONTHS_LONG[p.month]} ${p.year}, ${WEEKDAYS[p.weekday]}`;
}

/** Saat dilimine göre sahne: gündüz · gün batımı · gece (Türkiye saati). */
export function sceneOf(hour: number): "day" | "dusk" | "night" {
  if (hour >= 7 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}


/* ------------------------------ v4 kahraman + paneller ------------------------------ */

/** Kahraman özet cümlesinin parçaları: sayılar kalın (`strong`) çizilir; `heroSentence` ile aynı kurallar. */
export type SentencePart = { text: string; strong?: boolean };

export function heroSentenceParts(i: { appointments: number | null; demands: number | null; listingUpdates: number | null; mine: boolean }): SentencePart[] {
  const items: [number, string][] = [];
  if (i.appointments) items.push([i.appointments, ` randevu${i.mine ? "nuz" : ""}`]);
  if (i.demands) items.push([i.demands, ` yeni müşteri talebi${i.mine ? "niz" : ""}`]);
  if (i.listingUpdates) items.push([i.listingUpdates, " ilan güncellemesi"]);
  if (items.length === 0) return [{ text: "Bugün için bekleyen acil bir iş görünmüyor; yeni kayıtlarla güne başlayabilirsiniz." }];
  const out: SentencePart[] = [{ text: "Bugün " }];
  items.forEach(([n, label], idx) => {
    if (idx > 0) out.push({ text: idx === items.length - 1 ? " ve " : ", " });
    out.push({ text: n.toLocaleString("tr-TR"), strong: true }, { text: label });
  });
  out.push({ text: items.length === 1 ? " bekliyor." : " sizi bekliyor." });
  return out;
}

/** Kahramandaki durum hapları: acil (gecikmiş) kalemlerin toplamı ve karar bekleyen onay sayısı (Dikkat listesiyle AYNI küme). */
export function heroStatusCounts(items: readonly { id: string; level: string; count?: number }[]): { overdue: number; approvals: number } {
  let overdue = 0;
  let approvals = 0;
  for (const it of items) {
    if (it.level === "acil") overdue += it.count ?? 0;
    if (it.id === "onay") approvals += it.count ?? 0;
  }
  return { overdue, approvals };
}

/**
 * "Kurulumunu tamamla" kontrol listesi: en çok `max` adım; sıradaki adım listede kalır, önünde en çok iki tamamlanan
 * adım (ilerleme hissi), ardında bekleyenler. İsteğe bağlı adımlar listeye girmez (yüzdeye de sayılmaz).
 */
export function setupChecklist<S extends { id: string; done: boolean; optional?: boolean }>(steps: readonly S[], nextId: string | null, max = 4): (S & { next: boolean })[] {
  const req = steps.filter((s) => !s.optional);
  const nextIdx = Math.max(0, req.findIndex((s) => s.id === nextId));
  const before = req.slice(0, nextIdx).filter((s) => s.done).slice(-2);
  const after = req.slice(nextIdx);
  return [...before, ...after].slice(0, max).map((s) => ({ ...s, next: s.id === nextId }));
}

/**
 * "Bugün ofiste olanlar" durum satırı: kişinin bugünkü SON denetim kaydından (audit_logs.action / entity_type) kısa, resmi
 * bir faaliyet adı. Tanınmayan kayıt "Sistemde çalışıyor" olur (uydurma ayrıntı yok).
 */
export function activityStatus(action: string | null, entityType: string | null): string {
  const a = (action ?? "").toLowerCase();
  const e = (entityType ?? a.split(".")[0] ?? "").toLowerCase();
  if (e.startsWith("appointment") || a.startsWith("appointment")) return "Müşteri görüşmesi";
  if (e.startsWith("call") || a.startsWith("call")) return "Telefon görüşmesi";
  if (e.startsWith("property_media") || a.startsWith("property_media")) return "Fotoğraf yüklüyor";
  if (e.startsWith("property") || e.startsWith("listing") || a.startsWith("publishing")) return "İlan güncelliyor";
  if (e.startsWith("customer") || e.startsWith("demand")) return "Müşteri kaydı";
  if (e.startsWith("task")) return "Görev üzerinde";
  if (e.startsWith("deal") || e.startsWith("offer") || e.startsWith("contract")) return "Anlaşma hazırlıyor";
  if (e.startsWith("commission") || e.startsWith("finance") || e.startsWith("expense")) return "Finans kaydı";
  if (e.startsWith("match")) return "Eşleşme gönderiyor";
  if (e.startsWith("report")) return "Rapor hazırlıyor";
  return "Sistemde çalışıyor";
}

/* ============================ BUGÜN OFİSTE OLANLAR (birleştirme) ============================ */

export type TeamProfile = { id: string; full_name: string | null; avatar_url: string | null; avatar_preset: string | null; role: string | null; title: string | null; is_active: boolean | null };
export type TeamLog = { action: string | null; entity_type: string | null; created_at: string };
export type TeamTodayPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  avatarPreset: string | null;
  /** Unvan (profil `title`) yoksa rol etiketi. */
  roleTitle: string;
  /** Bugünkü etkin durum; gün bitmişse "offline", hiç seçilmemişse null. */
  presence: PresenceStatus | null;
  note: string | null;
  /** Son denetim kaydının kısa adı ("İlan güncelliyor"); kayıt yoksa null. */
  activity: string | null;
  /** Son görülme: durum değişikliği ile son denetim kaydının geç olanı (epoch ms). */
  atMs: number;
  /** Bugün aktif: bugünkü (çevrimdışı olmayan) durum ya da bugünkü denetim kaydı. */
  today: boolean;
  /** Son kaydın günü (ofis kontrolü süzgeci için, YYYY-MM-DD). */
  day: string;
};

/**
 * Ekip listesi: durum satırları (`user_presence`) + kişi başı SON denetim kaydı + profiller. Pasif/ofis dışı profil
 * listelenmez. Sıra: bugün aktif olanlar önde, sonra durum sırası (Ofiste → Görüşmede → Sahada → Mola → Uzakta → durumsuz →
 * Çevrimdışı), sonra yenilik. `total` yalnız bugün aktif olanlardır (sahte "çevrimiçi" yok).
 */
export function buildTeamToday(input: {
  profiles: readonly TeamProfile[];
  logs: ReadonlyMap<string, TeamLog>;
  presence: ReadonlyMap<string, PresenceRow>;
  nowMs: number;
  dayStartIso: string;
}): { people: TeamTodayPerson[]; total: number } {
  const dayStart = Date.parse(input.dayStartIso);
  const people: TeamTodayPerson[] = [];
  for (const p of input.profiles) {
    if (p.is_active === false) continue;
    const log = input.logs.get(p.id) ?? null;
    const eff = effectivePresence(input.presence.get(p.id), input.nowMs);
    if (!log && !eff) continue;
    const logMs = log ? Date.parse(log.created_at) : NaN;
    const atMs = Math.max(Number.isFinite(logMs) ? logMs : -Infinity, eff ? eff.atMs : -Infinity);
    const today = Boolean(eff && !eff.expired && eff.status !== "offline") || (Number.isFinite(logMs) && logMs >= dayStart);
    people.push({
      id: p.id,
      name: p.full_name?.trim() || "Adsız kullanıcı",
      avatarUrl: p.avatar_url,
      avatarPreset: p.avatar_preset,
      roleTitle: p.title?.trim() || roleLabel(p.role),
      presence: eff ? eff.status : null,
      note: eff?.note ?? null,
      activity: log ? activityStatus(log.action, log.entity_type) : null,
      atMs,
      today,
      day: trDayKey(atMs),
    });
  }
  people.sort((a, b) => Number(b.today) - Number(a.today) || presenceRank(a.presence) - presenceRank(b.presence) || b.atMs - a.atMs);
  return { people, total: people.filter((x) => x.today).length };
}

/* ============================ OFİS DURUMU: alt satır (sistem + yedek) ============================ */

/** "Bugün 03:42" · "Dün 03:42" · "12 Eki 03:42" (Türkiye saati). */
export function backupWhen(atMs: number, nowMs: number): string {
  if (!Number.isFinite(atMs)) return "";
  const diff = trDayDiff(atMs, nowMs);
  const hm = formatTrTime(atMs);
  if (diff <= 0) return `Bugün ${hm}`;
  if (diff === 1) return `Dün ${hm}`;
  const p = trParts(atMs);
  return `${p.day} ${MONTHS_SHORT[p.month]} ${hm}`;
}

/** Son yedek sağlıklı mı: durumu "ok" ve en çok 2 gün önce (günlük yedek bir gece kaçarsa hâlâ yeşil, ikincisinde uyarı). */
export function backupHealthy(b: { atMs: number; status: string }, nowMs: number): boolean {
  return b.status === "ok" && Number.isFinite(b.atMs) && nowMs - b.atMs <= 2 * DAY_MS;
}

/** Son `n` haftalık kova için başlangıç anı (12 çubuklu mini grafikler: en eski → en yeni). */
export const SPARK_WEEKS = 12;

/* ============================ KURULUM SONRASI KART ============================ */

/**
 * Kurulum %100 olunca "Kurulumunu tamamla" kartının AYNI yerini (aynı ölçüyle) alan kart, role göre:
 *  - yönetim (ofis geneli görünümünde) → "Bu ayın hedefi" (ofis cirosu / hedef, tahmini ay sonu, en çok katkı veren),
 *  - danışman / takım lideri / yönetimde "Benim işlerim" → "Kişisel hedefim" (kazanç ya da kapanış hedefi + haftanın adımı),
 *  - muhasebe → "Ay sonu kapanışı" (geçen ayın kapanış kontrol listesi; `lib/finance/month-close`).
 */
export type PostSetupKind = "office-goal" | "personal-goal" | "month-close";

export function postSetupKind(i: { role: string | null | undefined; isManagement: boolean; scopeMine: boolean }): PostSetupKind {
  if (i.role === "accounting") return "month-close";
  return i.isManagement && !i.scopeMine ? "office-goal" : "personal-goal";
}

/**
 * Doğrusal tempoyla ay sonu TAHMİNİ (etiketli gösterilir: "Bu hızla ay sonu ≈ ₺X"). Ayın ilk %10'unda (≈3 gün) ya da
 * gerçekleşme yokken tahmin üretilmez (sahte kesinlik yok); ay bittiyse tahmin değil gerçekleşme vardır.
 */
export function monthEndEstimate(actual: number, elapsedPct: number): number | null {
  if (!Number.isFinite(actual) || actual <= 0) return null;
  if (!(elapsedPct >= 10) || elapsedPct >= 100) return null;
  return Math.round(actual / (elapsedPct / 100));
}

export type GoalMetric = "revenue" | "deals";
export type GoalView =
  | { state: "no-target"; daysLeft: number }
  | {
      state: "tracking";
      metric: GoalMetric;
      /** Halka yüzdesi (0–100; aşımda 100). */
      ringPct: number;
      /** Gerçek gerçekleşme yüzdesi (aşım >100 görünür). */
      pct: number;
      actual: number;
      target: number;
      /** Tahmini ay sonu (yalnız tutar hedefinde ve yeterli veride). */
      estimate: number | null;
      daysLeft: number;
      exceeded: boolean;
    };

/**
 * Hedef kartının görünümü (SAF): önce tutar hedefi (komisyon görme yetkisiyle), yoksa kapanış (kazanılan anlaşma) hedefi.
 * Hedef girilmemişse `no-target` (yüzde, tahmin, ilerleme yok; tek çıkış "Hedef belirleyin").
 */
export function buildGoalView(i: {
  targetRevenue: number | null | undefined;
  targetDeals: number | null | undefined;
  actualRevenue: number | null;
  wonDeals: number | null;
  canSeeMoney: boolean;
  elapsedPct: number;
  daysLeft: number;
}): GoalView {
  const daysLeft = Math.max(1, Math.floor(i.daysLeft));
  const tRev = Number(i.targetRevenue ?? 0);
  const tDeals = Number(i.targetDeals ?? 0);
  const make = (metric: GoalMetric, actual: number, target: number): GoalView => {
    const pct = Math.round((actual / target) * 100);
    return {
      state: "tracking",
      metric,
      pct,
      ringPct: Math.max(0, Math.min(100, pct)),
      actual,
      target,
      estimate: metric === "revenue" ? monthEndEstimate(actual, i.elapsedPct) : null,
      daysLeft,
      exceeded: pct >= 100,
    };
  };
  if (i.canSeeMoney && tRev > 0 && i.actualRevenue != null) return make("revenue", Math.max(0, i.actualRevenue), tRev);
  if (tDeals > 0 && i.wonDeals != null) return make("deals", Math.max(0, i.wonDeals), tDeals);
  return { state: "no-target", daysLeft };
}

/* ============================ DİKKAT: TEK KAYIT SATIRLARI ============================ */

export type AttentionLevel = "acil" | "yuksek" | "orta" | "dusuk";

/**
 * "Dikkat gerektirenler" satırı (v5 referansı): her kategorinin EN ÖNCELİKLİ tek gerçek kaydı ("Geciken kira tahsilatı ·
 * Cevahir Residence D-12 · Ahmet Yılmaz · 12 gün geçti"). `at`: yaşın ölçüldüğü an (vade, yayın/teyit, talep açılışı,
 * randevu saati); `total`: kategorideki toplam kayıt (satırda "+N daha"); kayıt okunamazsa kategori satırı `detail`
 * yerine açıklamayla kalır (sahte kayıt yok).
 */
export type AttentionRecord = {
  key: string;
  level: AttentionLevel;
  title: string;
  detail: string | null;
  at: string | null;
  /** `elapsed`: "12 gün geçti"; `slot`: randevu saati ("Bugün 14:30"); `none`: yaş yok (tutar/sayım kalemi). */
  ageKind: "elapsed" | "slot" | "none";
  href: string;
  total: number | null;
};

const ATTN_RANK: Record<AttentionLevel, number> = { acil: 0, yuksek: 1, orta: 2, dusuk: 3 };

/**
 * Sıralama (SAF): önce önem (Acil → Yüksek → Orta → Düşük), eşitlikte EN ESKİ kayıt önde (yaşı olmayan sonda), sonra
 * giriş sırası. `max` satır döner; kesilen kategori sayısı `hidden`.
 */
export function rankAttentionRecords(rows: readonly AttentionRecord[], max = 5): { rows: AttentionRecord[]; hidden: number } {
  const ms = (r: AttentionRecord) => (r.at ? Date.parse(r.at) : NaN);
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const lv = ATTN_RANK[a.r.level] - ATTN_RANK[b.r.level];
      if (lv) return lv;
      const am = ms(a.r);
      const bm = ms(b.r);
      const aOk = Number.isFinite(am);
      const bOk = Number.isFinite(bm);
      if (aOk && bOk && am !== bm) return am - bm;
      if (aOk !== bOk) return aOk ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ r }) => r);
  const cap = Math.max(0, max);
  return { rows: sorted.slice(0, cap), hidden: Math.max(0, sorted.length - cap) };
}

/** Takvim günü farkı (Türkiye saati): bugün 0, dün 1. */
export function trDayDiff(atMs: number, nowMs: number): number {
  const a = Date.parse(`${trDayKey(atMs)}T00:00:00Z`);
  const b = Date.parse(`${trDayKey(nowMs)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

/** Satırın yaş metni: "12 gün geçti" · "Bugün" · "Bugün 14:30" (randevu) · "Yarın 09:00"; yaş yoksa null. */
export function attentionAge(r: Pick<AttentionRecord, "at" | "ageKind">, nowMs: number): string | null {
  if (r.ageKind === "none" || !r.at) return null;
  const at = Date.parse(r.at);
  if (!Number.isFinite(at)) return null;
  const diff = trDayDiff(at, nowMs);
  if (r.ageKind === "slot") {
    const day = diff === 0 ? "Bugün" : diff === -1 ? "Yarın" : diff === 1 ? "Dün" : null;
    return day ? `${day} ${formatTrTime(at)}` : formatTrTime(at);
  }
  if (diff <= 0) return "Bugün";
  return `${diff.toLocaleString("tr-TR")} gün geçti`;
}

/** Kategoride gösterilen kaydın dışında kalanlar: "+11 daha" (tek kayıtta ya da sayım yokken null). */
export function attentionMore(total: number | null): string | null {
  return total != null && total > 1 ? `+${(total - 1).toLocaleString("tr-TR")} daha` : null;
}

/**
 * Kira tahakkukunun vade anı (TR gece yarısı): dönem ayın 1'i + (vade günü − 1). Geçersiz girdide null.
 * Ör. period 2026-10-01, due_day 5 → 2026-10-05.
 */
export function rentDueIso(period: string | null | undefined, dueDay: number | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(period ?? "");
  if (!m) return null;
  const day = Math.min(28, Math.max(1, Math.floor(Number(dueDay ?? 1)) || 1));
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, day) - TR_OFFSET_MS).toISOString();
}

/** Kayıt alt satırı: boş parçaları atıp " · " ile birleştirir ("Cevahir Residence D-12 · Ahmet Yılmaz"). */
export function joinDetail(...parts: (string | null | undefined)[]): string | null {
  const s = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return s.length ? s.join(" · ") : null;
}

/* ============================ BUGÜN OFİSTE: SON FAALİYET ZAMANI ============================ */

/** Ekip kartında son faaliyetin zamanı: bugün "14:05", dün "Dün", daha eski "3 gün önce". */
export function activityWhen(atIso: string, nowMs: number): string {
  const at = Date.parse(atIso);
  if (!Number.isFinite(at)) return "";
  const diff = trDayDiff(at, nowMs);
  if (diff <= 0) return formatTrTime(at);
  if (diff === 1) return "Dün";
  return `${diff.toLocaleString("tr-TR")} gün önce`;
}

/**
 * "Portal teyit bekleyen" karosundaki "+N": son 24 saatte teyit süresini AŞAN (yaşı tam eşik gününde olan) yayındaki
 * ilan sayısı — gerçek geçiş, tahmin değil.
 */
export function newlyOverdueListings(rows: readonly ConfirmableListing[], nowMs: number): number {
  return rows.filter((r) => confirmationAgeDays(r, nowMs) === LISTING_CONFIRM_STALE_DAYS).length;
}

/* ============================ ROL → KPI / PANEL / DİKKAT MATRİSİ ============================ */

/**
 * Ana ekran KPI kartı anahtarları (rol bazlı; her rolün 5 kartı). Etiketler tek satıra sığacak kısalıktadır; sayıların
 * tamamı gerçek kaynaktan gelir (bkz. `loadRoleKpis`), kaynağı okunamayan kart çizilmez (sahte sıfır yok).
 */
export type RoleKpiKey =
  // Ofis yönetimi (sahip / genel müdür, ofis geneli)
  | "ciro"
  | "aktif-anlasma"
  | "yeni-talep"
  | "yeni-musteri"
  | "gelen-arama"
  // Şube operasyonu (şube müdürü)
  | "bugunku-randevu"
  | "atanmamis-portfoy"
  | "geciken-gorev"
  | "teyit-bekleyen"
  // Takım lideri (takımının toplamı)
  | "ekip-kapanis"
  | "ekip-anlasma"
  | "ekip-geciken-gorev"
  | "ekip-randevu"
  | "ekip-yeni-musteri"
  // Danışman (kişisel)
  | "kazancim"
  | "hedefime-kalan"
  | "aktif-anlasmam"
  | "bugunku-randevum"
  | "musterilerim"
  // Muhasebe
  | "kasa-banka"
  | "bu-ay-net"
  | "vadesi-gecen"
  | "bu-ay-gider"
  | "incelenecek"
  | "bu-ay-komisyon"
  // Çağrı merkezi
  | "bugun-gelen-arama"
  | "cevapsiz-arama"
  | "yanit-suresi"
  | "bugun-yeni-musteri"
  | "bugun-randevu";

/** Kartın görünmesi için gereken modül görme yetkileri (hepsi). Para kartları komisyon ya da finans yetkisi ister. */
export const KPI_REQUIRES: Record<RoleKpiKey, readonly string[]> = {
  ciro: ["commissions"],
  "aktif-anlasma": ["commissions"],
  "yeni-talep": ["demands"],
  "yeni-musteri": ["customers"],
  "gelen-arama": ["calls"],
  "bugunku-randevu": ["appointments"],
  "atanmamis-portfoy": ["properties"],
  "geciken-gorev": ["tasks"],
  "teyit-bekleyen": ["portals"],
  "ekip-kapanis": ["commissions"],
  "ekip-anlasma": ["commissions"],
  "ekip-geciken-gorev": ["tasks"],
  "ekip-randevu": ["appointments"],
  "ekip-yeni-musteri": ["customers"],
  kazancim: ["commissions"],
  "hedefime-kalan": ["commissions", "targets"],
  "aktif-anlasmam": ["commissions"],
  "bugunku-randevum": ["appointments"],
  musterilerim: ["customers"],
  "kasa-banka": ["expenses"],
  "bu-ay-net": ["expenses"],
  "vadesi-gecen": ["expenses"],
  "bu-ay-gider": ["expenses"],
  incelenecek: ["expenses"],
  "bu-ay-komisyon": ["commissions"],
  "bugun-gelen-arama": ["calls"],
  "cevapsiz-arama": ["calls"],
  "yanit-suresi": ["customers"],
  "bugun-yeni-musteri": ["customers"],
  "bugun-randevu": ["appointments"],
};

/** Sağ cam panelin türü: yönetim "Ofis durumu", takım lideri "Ekibim bugün", danışman "Benim günüm", muhasebe "Finans durumu", çağrı "Arama durumu". */
export type RolePanel = "ofis-durumu" | "ekibim" | "benim-gunum" | "finans-durumu" | "arama-durumu";

/** Dikkat gerektirenler kategorileri (rol bazlı küme; sıralama `rankAttentionRecords`). */
export type AttentionCategory =
  | "tahsilat"
  | "gorev"
  | "onay"
  | "riskli-anlasma"
  | "komisyon"
  | "pasif"
  | "teyit"
  | "geri-donus"
  | "randevu"
  | "vadesi-gecen-alacak"
  | "banka-eslesmemis"
  | "cevapsiz-arama";

export type RoleHomePlan = {
  /** Kişinin rol adı (rapor ve test için). */
  persona: "ofis-yonetimi" | "sube-operasyonu" | "takim-lideri" | "danisman" | "muhasebe" | "cagri-merkezi";
  kpis: RoleKpiKey[];
  panel: RolePanel;
  attention: AttentionCategory[];
};

type Persona = RoleHomePlan["persona"];

/** Aday sırası: önce rolün ana kartları, yetkisi olmayan kart düşerse yedekler (yine rolün işine dair) sırayla girer. */
const KPI_CANDIDATES: Record<Persona, { main: RoleKpiKey[]; spare: RoleKpiKey[] }> = {
  "ofis-yonetimi": { main: ["ciro", "aktif-anlasma", "yeni-talep", "yeni-musteri", "gelen-arama"], spare: ["bugunku-randevu", "geciken-gorev", "teyit-bekleyen"] },
  "sube-operasyonu": { main: ["ciro", "aktif-anlasma", "bugunku-randevu", "atanmamis-portfoy", "geciken-gorev"], spare: ["teyit-bekleyen", "yeni-talep", "yeni-musteri"] },
  "takim-lideri": { main: ["ekip-kapanis", "ekip-anlasma", "ekip-geciken-gorev", "ekip-randevu", "ekip-yeni-musteri"], spare: ["kazancim", "bugunku-randevum", "musterilerim"] },
  danisman: { main: ["kazancim", "hedefime-kalan", "aktif-anlasmam", "bugunku-randevum", "musterilerim"], spare: ["geciken-gorev", "yeni-talep"] },
  muhasebe: { main: ["kasa-banka", "bu-ay-net", "vadesi-gecen", "bu-ay-gider", "incelenecek"], spare: ["bu-ay-komisyon"] },
  "cagri-merkezi": { main: ["bugun-gelen-arama", "cevapsiz-arama", "yanit-suresi", "bugun-yeni-musteri", "bugun-randevu"], spare: ["geciken-gorev"] },
};

const PANEL_OF: Record<Persona, RolePanel> = {
  "ofis-yonetimi": "ofis-durumu",
  "sube-operasyonu": "ofis-durumu",
  "takim-lideri": "ekibim",
  danisman: "benim-gunum",
  muhasebe: "finans-durumu",
  "cagri-merkezi": "arama-durumu",
};

const ATTENTION_OF: Record<Persona, AttentionCategory[]> = {
  "ofis-yonetimi": ["tahsilat", "gorev", "onay", "teyit", "geri-donus", "riskli-anlasma", "randevu", "komisyon", "pasif"],
  "sube-operasyonu": ["tahsilat", "gorev", "onay", "teyit", "geri-donus", "riskli-anlasma", "randevu", "komisyon", "pasif"],
  "takim-lideri": ["gorev", "onay", "geri-donus", "riskli-anlasma", "randevu", "komisyon"],
  danisman: ["gorev", "geri-donus", "riskli-anlasma", "randevu", "komisyon"],
  // Ay sonu kapanışı aynı ekranın sağ kartındadır ("Ay sonu kapanışı"), burada tekrarlanmaz.
  muhasebe: ["vadesi-gecen-alacak", "tahsilat", "banka-eslesmemis", "komisyon"],
  "cagri-merkezi": ["cevapsiz-arama", "geri-donus", "randevu", "gorev"],
};

/**
 * ROL → ANA EKRAN PLANI (SAF; tek karar noktası). Rol modeli `@/lib/nav-roles` ile aynıdır: owner/gm ofis yönetimi,
 * branch_manager şube operasyonu, team_lead takım lideri, advisor/readonly danışman, accounting muhasebe, call_center çağrı
 * merkezi. Yönetim "Benim işlerim" kapsamına geçince kişisel (danışman) plan kullanılır. `canView(modül)` yetkisi olmayan
 * kart çıkar, yerine rolün yedek kartı girer; en çok 5 kart.
 */
export function roleHomePlan(role: string | null | undefined, canView: (module: string) => boolean, opts: { scopeMine?: boolean } = {}): RoleHomePlan {
  const persona: Persona =
    role === "owner" || role === "gm"
      ? opts.scopeMine
        ? "danisman"
        : "ofis-yonetimi"
      : role === "branch_manager"
        ? opts.scopeMine
          ? "danisman"
          : "sube-operasyonu"
        : role === "team_lead"
          ? "takim-lideri"
          : role === "accounting"
            ? "muhasebe"
            : role === "call_center"
              ? "cagri-merkezi"
              : "danisman";
  const { main, spare } = KPI_CANDIDATES[persona];
  const ok = (k: RoleKpiKey) => KPI_REQUIRES[k].every((m) => canView(m));
  const kpis = [...main, ...spare].filter(ok).slice(0, 5);
  return { persona, kpis, panel: PANEL_OF[persona], attention: ATTENTION_OF[persona] };
}

/** "Bugün **2** randevunuz, **3** göreviniz ve **1** …" — sıfır/bilinmeyen kalem atlanır; hiçbiri yoksa sakin cümle. */
function countSentence(items: readonly [number | null | undefined, string][], tail: string, calm: string): SentencePart[] {
  const live = items.filter((x): x is [number, string] => typeof x[0] === "number" && x[0] > 0);
  if (live.length === 0) return [{ text: calm }];
  const out: SentencePart[] = [{ text: "Bugün " }];
  live.forEach(([n, label], idx) => {
    if (idx > 0) out.push({ text: idx === live.length - 1 ? " ve " : ", " });
    out.push({ text: n.toLocaleString("tr-TR"), strong: true }, { text: label });
  });
  out.push({ text: tail });
  return out;
}

export type RoleSentenceCounts = {
  appointments?: number | null;
  demands?: number | null;
  listingUpdates?: number | null;
  tasksDue?: number | null;
  overdueTasks?: number | null;
  callbacks?: number | null;
  callsToday?: number | null;
  missedCalls?: number | null;
};

/**
 * Kahraman özet cümlesi ROL BAZLI (SAF): yönetim ofisin günü (randevu · yeni talep · ilan güncellemesi), takım lideri
 * ekibinin günü, danışman kendi günü (randevunuz · göreviniz · geri dönüş bekleyen müşteriniz), çağrı merkezi arama
 * kuyruğu. Muhasebe cümlesi finans kaynağından ayrıca kurulur (blocks.tsx `AccountingSummary`).
 */
export function roleSentenceParts(persona: RoleHomePlan["persona"], c: RoleSentenceCounts): SentencePart[] {
  const calm = "Bugün için bekleyen acil bir iş görünmüyor; yeni kayıtlarla güne başlayabilirsiniz.";
  switch (persona) {
    case "danisman":
      return countSentence([[c.appointments, " randevunuz"], [c.tasksDue, " göreviniz"], [c.callbacks, " geri dönüş bekleyen müşteriniz"]], " var.", calm);
    case "takim-lideri":
      return countSentence([[c.appointments, " ekip randevusu"], [c.overdueTasks, " geciken ekip görevi"], [c.callbacks, " geri dönüş bekleyen müşteri"]], " var.", calm);
    case "cagri-merkezi":
      return countSentence([[c.callsToday, " gelen arama"], [c.missedCalls, " cevapsız arama"], [c.callbacks, " geri dönüş bekleyen talep"]], " var.", "Bugün henüz arama kaydı yok; arama listesiyle güne başlayabilirsiniz.");
    default:
      return heroSentenceParts({ appointments: c.appointments ?? null, demands: c.demands ?? null, listingUpdates: c.listingUpdates ?? null, mine: false });
  }
}
