/**
 * Malik haftalık pazarlama raporu (SAF). Ofis ayarı `office.owner_report.weekly_enabled` (varsayılan KAPALI).
 *
 * DÜRÜSTLÜK: yalnız ofisin KENDİ kaydı sayılır (randevu, teklif, ziyaret sonrası anket, vitrin görüntülenmesi, ofisin
 * kaydettiği portal yayını). Portal (sahibinden vb.) görüntülenme verisi YOKTUR ve uydurulmaz. Vitrin sayacı ISR
 * nedeniyle yaklaşıktır ("yaklaşık" etiketi). Veri olmayan satır "kayıt yok" yazılır, sıfır gibi sunulmaz.
 * Kişisel veri yok: alıcı adı/telefonu, teklif sahibi raporda yer almaz.
 */
import { formatNumberTr } from "@/lib/format";

export type OwnerReportFacts = {
  showings: { total: number; completed: number };
  offers: { newCount: number; openCount: number };
  feedback: { answered: number; avgScore: number | null; reasons: { label: string; count: number }[] };
  views: { thisWeek: number | null; prevWeek: number | null };
  liveListings: number;
};

export type OwnerReportLine = { key: string; label: string; value: string; hint?: string };

export type OwnerWeeklyReport = {
  periodLabel: string;
  lines: OwnerReportLine[];
  /** Hiçbir hareket yoksa true (rapor yine gösterilir ama "bu hafta hareket yok" der). */
  empty: boolean;
};

const fmtInt = formatNumberTr;

/** "29 Eyl – 5 Eki 2026" (TR, gün anahtarlarından; saf). */
export function periodLabel(startKey: string, endKeyInclusive: string): string {
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const [ys, ms, ds] = startKey.split("-").map(Number);
  const [ye, me, de] = endKeyInclusive.split("-").map(Number);
  const left = `${ds} ${months[ms - 1]}${ys !== ye ? ` ${ys}` : ""}`;
  return `${left} – ${de} ${months[me - 1]} ${ye}`;
}

export function buildOwnerWeeklyReport(facts: OwnerReportFacts, period: string): OwnerWeeklyReport {
  const lines: OwnerReportLine[] = [];
  lines.push({
    key: "showings",
    label: "Yer gösterme",
    value: facts.showings.total > 0 ? `${fmtInt(facts.showings.total)} randevu (${fmtInt(facts.showings.completed)} tamamlandı)` : "Bu hafta randevu yok",
  });
  lines.push({
    key: "offers",
    label: "Teklif",
    value: facts.offers.newCount > 0 ? `${fmtInt(facts.offers.newCount)} yeni teklif` : "Bu hafta yeni teklif yok",
    hint: facts.offers.openCount > 0 ? `${fmtInt(facts.offers.openCount)} teklif değerlendirmenizi bekliyor` : undefined,
  });
  if (facts.feedback.answered > 0) {
    const top = facts.feedback.reasons.filter((r) => r.label && r.label !== "Hayır").slice(0, 2);
    lines.push({
      key: "feedback",
      label: "Ziyaretçi geri bildirimi",
      value: `${fmtInt(facts.feedback.answered)} yanıt${facts.feedback.avgScore != null ? ` · ortalama ${facts.feedback.avgScore.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}/10` : ""}`,
      hint: top.length > 0 ? `Öne çıkan çekince: ${top.map((r) => `${r.label} (${r.count})`).join(", ")}` : undefined,
    });
  } else {
    lines.push({ key: "feedback", label: "Ziyaretçi geri bildirimi", value: "Bu hafta yanıt yok" });
  }
  if (facts.views.thisWeek !== null) {
    const prev = facts.views.prevWeek;
    const trend = prev !== null && prev > 0 ? Math.round(((facts.views.thisWeek - prev) / prev) * 100) : null;
    lines.push({
      key: "views",
      label: "Ofis vitrininde görüntülenme",
      value: `yaklaşık ${fmtInt(facts.views.thisWeek)}`,
      hint: trend !== null ? `Önceki haftaya göre ${trend >= 0 ? "+" : "−"}%${Math.abs(trend)}` : undefined,
    });
  }
  lines.push({
    key: "listings",
    label: "Yayındaki portal ilanı",
    value: facts.liveListings > 0 ? `${fmtInt(facts.liveListings)} portal` : "Kayıtlı yayın yok",
  });
  const empty =
    facts.showings.total === 0 && facts.offers.newCount === 0 && facts.feedback.answered === 0 && !(facts.views.thisWeek && facts.views.thisWeek > 0);
  return { periodLabel: period, lines, empty };
}

/** SMS metni (kısa, kişisel veri yok; yalnız bağlantı). 160 karakter hedefi; ofis adı kısaltılır. */
export function buildOwnerReportSms(officeName: string, propertyLabel: string, url: string): string {
  const office = officeName.length > 30 ? `${officeName.slice(0, 29)}…` : officeName;
  const prop = propertyLabel.length > 28 ? `${propertyLabel.slice(0, 27)}…` : propertyLabel;
  return `${office}: ${prop} için haftalık ilan raporunuz hazır: ${url}`;
}

/** Tekrar önleme anahtarı: belirteç + hafta başı. */
export function ownerReportDedupeKey(tokenId: string, weekStartKey: string): string {
  return `owner-report:${tokenId}:${weekStartKey}`;
}

/** Son tamamlanmış Pzt–Paz haftası (TR günleri). `todayKey` = trDayKey(). */
export function lastFullWeek(todayKey: string): { startDay: string; endDayExclusive: string; prevStartDay: string; endDayInclusive: string } {
  const t = Date.parse(`${todayKey}T00:00:00Z`);
  const dow = new Date(t).getUTCDay() || 7; // Pzt=1..Paz=7
  const thisMonday = t - (dow - 1) * 86_400_000;
  const start = thisMonday - 7 * 86_400_000;
  const k = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { startDay: k(start), endDayExclusive: k(thisMonday), prevStartDay: k(start - 7 * 86_400_000), endDayInclusive: k(thisMonday - 86_400_000) };
}

/** TR gün anahtarını ISO ana çevirir (gün başı, +03:00). */
export function trDayStartIsoOf(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00+03:00`).toISOString();
}
