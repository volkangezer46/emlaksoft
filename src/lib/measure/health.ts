/**
 * Ölçüm sağlığı (SAF): A–F notu + her bulgu için teknik olmayan tek cümle.
 *
 * Kontroller: (1) ölçüm tabloları kurulu mu, (2) son 24 saatte beacon akışı var mı, (3) atıf kapsama oranı
 * (kaynağı bilinen kayıt / kayıt; < %80 uyarı, yeterli örnek varsa), (4) tampon yazım hatası.
 * Puan 100'den başlar; bulgu ağırlığı düşülür, taban 0. Not: A ≥90, B ≥75, C ≥60, D ≥45, E ≥30, F <30.
 * Veri yoksa uydurma yapılmaz: kayıt yoksa kapsama kontrolü "veri birikiyor" olarak atlanır (puan düşmez).
 */
export type HealthSeverity = "kritik" | "uyari" | "bilgi";
export type HealthFinding = { code: string; severity: HealthSeverity; text: string; href: string };
export type HealthGrade = "A" | "B" | "C" | "D" | "E" | "F";

export type HealthInput = {
  /** Tablolar/RPC kurulu değil (migration bekliyor). */
  tableMissing: boolean;
  /** Ayarlar: sayaç kapalıysa akış kontrolü yapılmaz. */
  pageviewsEnabled: boolean;
  /** Son 24 saatte (bugün+dün TR günü sayaçları ya da bu süreçte kabul edilen son beacon) akış oldu mu; bilinmiyorsa null. */
  flowLast24h: boolean | null;
  /** Dönemdeki kayıt sayısı ve kaynağı bilinenler; okunamadıysa null. */
  coverage: { signups: number; attributed: number } | null;
  /** Atıf taşıma açık mı (kapalıyken düşük kapsama beklenen durumdur; bilgi olarak söylenir). */
  attributionEnabled: boolean;
  /** Tampon son yazım hatası (bu süreç). */
  bufferError: string | null;
};

export type HealthReport = { score: number; grade: HealthGrade; findings: HealthFinding[] };

export const COVERAGE_WARN = 0.8;
/** Kapsama oranı bu kadar kayıttan az örnekle yorumlanmaz. */
export const COVERAGE_MIN_SIGNUPS = 5;

const WEIGHT: Record<HealthSeverity, number> = { kritik: 40, uyari: 20, bilgi: 0 };
const HREF = "/admin/site/reklam";

export function gradeOf(score: number): HealthGrade {
  return score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 45 ? "D" : score >= 30 ? "E" : "F";
}

export function measureHealth(input: HealthInput): HealthReport {
  const findings: HealthFinding[] = [];
  if (input.tableMissing) {
    findings.push({
      code: "olcum-tablo-yok",
      severity: "kritik",
      text: "Ziyaret sayacı henüz kurulmadı; sistem güncellemesi bekleniyor. Bu sürede ziyaretler sayılmıyor.",
      href: HREF,
    });
    return { score: 0, grade: "F", findings };
  }
  if (input.pageviewsEnabled && input.flowLast24h === false) {
    findings.push({
      code: "olcum-akis-yok",
      severity: "kritik",
      text: "Son 24 saatte sitenizden hiç ziyaret sinyali gelmedi; sayaç çalışmıyor olabilir.",
      href: HREF,
    });
  }
  if (!input.pageviewsEnabled) {
    findings.push({ code: "olcum-sayac-kapali", severity: "bilgi", text: "Ziyaret sayacı kapalı; huni ziyaret aşamasını gösteremez.", href: HREF });
  }
  if (input.bufferError) {
    findings.push({
      code: "olcum-tampon-hata",
      severity: "uyari",
      text: "Son ziyaret sayıları kaydedilirken sorun çıktı; sistem birkaç dakika içinde yeniden deneyecek.",
      href: HREF,
    });
  }
  const c = input.coverage;
  if (c && c.signups >= COVERAGE_MIN_SIGNUPS) {
    const rate = c.attributed / c.signups;
    if (rate < COVERAGE_WARN) {
      const pct = Math.round(rate * 100);
      findings.push(
        input.attributionEnabled
          ? {
              code: "olcum-atif-kapsama",
              severity: "uyari",
              text: `Yeni kayıtların yalnız %${pct}'inin nereden geldiğini biliyoruz; reklam ve kanal kararları eksik veriyle verilir.`,
              href: HREF,
            }
          : {
              code: "olcum-atif-kapali",
              severity: "bilgi",
              text: `Yeni kayıtların %${pct}'inin kaynağı biliniyor; kayıt kaynağını taşımayı açarsanız oran yükselir.`,
              href: `${HREF}#olcum-ayarlari`,
            },
      );
    }
  }
  const score = Math.max(0, 100 - findings.reduce((s, f) => s + WEIGHT[f.severity], 0));
  return { score, grade: gradeOf(score), findings };
}
