import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDateTimeTr, formatDateTr } from "@/lib/format";
import { trDayKey } from "@/lib/clock";

/**
 * SAAT DİLİMİ SÖZLEŞMESİ (B076). Uygulama konteyneri ve DB UTC çalışıyordu; `timeZone` vermeden biçimlenen saatler
 * SSR'da UTC çıkıyor (14:00 randevu 11:00, gece 01:01 araması önceki gün), istemcide TR çıkıp hidrasyon hatası (#418)
 * veriyordu. Dockerfile artık TZ=Europe/Istanbul; ama kod TZ'ye GÜVENMEZ:
 *  - tarih/saat biçimi tek kaynaktan: `src/lib/format.ts` (`formatDateTr`, `formatDateTimeTr`; timeZone sabit),
 *  - gün/ay sınırı tek kaynaktan: `src/lib/clock.ts` (`trDayKey`, `trDayStartMs`, `trParts` …; saf epoch aritmetiği).
 *
 * (1) YENİ timeZone'suz `Intl.DateTimeFormat(` / `toLocaleDateString(` / `toLocaleTimeString(` / tarih
 *     `toLocaleString(` çağrısı eklenemez: dosya başına sayı tabandan büyükse test
 *     kırılır (taban aşağıda, `TZ_TZLESS_BASELINE`). Taban yalnız azalabilir (dosya düzeltildikçe sayısı düşürülür; düşmemesi testi kırmaz, artması kırar).
 * (2) Sunucu yerel saatine bağlı Date yöntemleri (`getHours/getDate/setHours/…`) yalnız denetlenmiş dosyalarda ve
 *     denetlenen sayıda olabilir; her dosya "yerel saat doğru" / "düzeltilmeli" / "düzeltildi" notlu.
 * Tam vitest hem TZ=UTC hem TZ=Europe/Istanbul ile yeşil olmalı (sözleşme l); aşağıdaki davranış testleri TZ'den
 * bağımsız aynı sonucu verir.
 */

type LocalTimeVerdict = "yerel saat doğru" | "düzeltilmeli" | "düzeltildi";

/**
 * Sunucu/tarayıcı yerel saatine bağlı Date yöntemi kullanan dosyalar (saha denetimi 2026-10-15, 14 dosya). `calls`
 * izin verilen en çok çağrı; "düzeltilmeli" kayıtları dosya sahibi pakette düzeltilene kadar TZ=Europe/Istanbul
 * konteyner ayarıyla doğru çalışır (TZ yayını o birleşmeleri bekler).
 */
const TZ_LOCAL_TIME_AUDIT: Record<string, { calls: number; verdict: LocalTimeVerdict; note: string }> = {
  "src/app/actions/ai-tenant-advisor.ts": {
    calls: 3,
    verdict: "düzeltilmeli",
    note: "SK12: öneri görevinin termini setDate/setHours(18) sunucu yerel günüyle; UTC'de 18:00 TR yerine 21:00 TR. trDayStartMs + 18 sa kullanılmalı.",
  },
  "src/app/actions/demo-login.ts": {
    calls: 2,
    verdict: "yerel saat doğru",
    note: "Deneme bitişi +365 gün (setDate): gün eklemesi saat diliminden bağımsız, Türkiye'de yaz saati yok.",
  },
  "src/app/admin/raporlar/page.tsx": {
    calls: 2,
    verdict: "düzeltilmeli",
    note: "SK6: 12 aylık eksen etiketleri sunucu yerel ayından (new Date(y, m - k, 1)); ayın 1'i TR 00-03 arası UTC'de önceki ay. trMonthKey/shiftMonthKey.",
  },
  "src/app/api/cron/gunluk-ozet/route.ts": {
    calls: 0,
    verdict: "düzeltildi",
    note: "SK5: gün başı setHours(0) yerine trDayStartIso (UTC konteynerde gün TR 03:00'te başlıyordu).",
  },
  "src/app/api/cron/haftalik-ozet/route.ts": {
    calls: 0,
    verdict: "düzeltildi",
    note: "SK5: hafta sınırı ve ISO hafta numarası trParts/trDayStartMs ile (pazartesi 00-03 TR önceki haftaya yazılıyordu).",
  },
  "src/app/app/bildirimler/announcements-manager.tsx": {
    calls: 0,
    verdict: "düzeltildi",
    note: "SK5: datetime-local varsayılanı toTrLocalInput (sunucu girdiyi TR sayar; tarayıcı yerel saati yurt dışında kaydırıyordu).",
  },
  "src/app/app/gelen-kutusu/calls-view.tsx": {
    calls: 0,
    verdict: "düzeltildi",
    note: "SK5: 7 günlük arama hacmi trDayKey ile TR gününe ayrılır (started_at.slice(0, 10) UTC günüydü).",
  },
  "src/app/app/gelen-kutusu/row-actions.tsx": {
    calls: 0,
    verdict: "düzeltildi",
    note: "SK5: yarın 09:00 varsayılanı toTrLocalInput ile; SSR (UTC) ve tarayıcı aynı günü üretir.",
  },
  "src/app/app/musteriler/data.ts": {
    calls: 9,
    verdict: "düzeltilmeli",
    note: "SK7: daysUntilAnnual 'bugün'ü sunucu yerel gününden alır; UTC'de TR 00-03 arası bir gün sapar. trTodayCalendarDate kullanılmalı.",
  },
  "src/app/app/randevular/appointment-week-view.tsx": {
    calls: 15,
    verdict: "yerel saat doğru",
    note: "Sahte yerel takvim günleri (trTodayCalendarDate / sayfadan gelen gün) aynı bölgede kurulup okunur; saat konumu trParts ile.",
  },
  "src/app/app/randevular/page.tsx": {
    calls: 48,
    verdict: "yerel saat doğru",
    note: "Pencere hesapları sahte yerel takvim günüyle; DB sınırı calendarDateToTrIso ile TR gece yarısına çevrilir.",
  },
  "src/lib/clock.ts": {
    calls: 4,
    verdict: "yerel saat doğru",
    note: "calendarDateToTrIso sahte yerel takvim gününü tasarım gereği yerel okur (trTodayCalendarDate eşi); biri yorum satırı.",
  },
  "src/lib/form-tabs.ts": {
    calls: 10,
    verdict: "yerel saat doğru",
    note: "Taslak kayıt saati yalnız tarayıcıda (mount sonrası, localStorage) kullanıcının kendi saatiyle gösterilir; SSR'da çalışmaz.",
  },
  "src/lib/sample-data-seed.ts": {
    calls: 0,
    verdict: "düzeltildi",
    note: "SK5: örnek veri saatleri trDayStartMs + saat ile (setHours UTC konteynerde 14:00 TR yerine 17:00 TR yazıyordu).",
  },
};

/**
 * timeZone'suz tarih biçimi tabanı (dosya → çağrı sayısı). 2026-10-15: 119 çağrı bulundu; 1'i sayı biçimi (sayılmaz),
 * 3'ü SK5'te düzeltildi (calls-view 2, franchise 1) → 115. Dosya düzeltildikçe sayısı düşürülür ya da satır silinir.
 */
const TZ_TZLESS_BASELINE: Record<string, number> = {
  "src/app/acik-ev-kayit/[token]/page.tsx": 2,
  "src/app/actions/customers.ts": 1,
  "src/app/actions/property-media.ts": 1,
  "src/app/actions/referrals.ts": 1,
  "src/app/actions/rentals.ts": 1,
  "src/app/actions/search.ts": 1,
  "src/app/admin/_dashboards/billing-home.tsx": 1,
  "src/app/admin/ayarlar/page.tsx": 1,
  "src/app/admin/billing/page.tsx": 3,
  "src/app/admin/danisman/advisor-chat.tsx": 1,
  "src/app/admin/members/[id]/access-inspector.tsx": 1,
  "src/app/admin/raporlar/page.tsx": 1,
  "src/app/admin/tenants/[id]/office-360-panels.tsx": 2,
  "src/app/admin/tenants/[id]/page.tsx": 2,
  "src/app/admin/tenants/[id]/team-member-tools.tsx": 1,
  "src/app/api/cron/kira-tahakkuk/route.ts": 1,
  "src/app/app/abonelik/cards-panel.tsx": 1,
  "src/app/app/abonelik/fatura/[id]/page.tsx": 1,
  "src/app/app/abonelik/page.tsx": 4,
  "src/app/app/acik-ev/[id]/page.tsx": 1,
  "src/app/app/acik-ev/page.tsx": 1,
  "src/app/app/aidat/cari-tab.tsx": 1,
  "src/app/app/aidat/makbuz/[paymentId]/page.tsx": 1,
  "src/app/app/aidat/page.tsx": 2,
  "src/app/app/aidat/tahakkuk-panels.tsx": 2,
  "src/app/app/aidat/tahsilat-panel.tsx": 1,
  "src/app/app/anlasmalar/[id]/page.tsx": 1,
  "src/app/app/asistan/advisor-chat.tsx": 1,
  "src/app/app/askida/page.tsx": 1,
  "src/app/app/bolge-analizi/page.tsx": 2,
  "src/app/app/cuzdan/page.tsx": 3,
  "src/app/app/degerleme/[id]/page.tsx": 1,
  "src/app/app/ekip/[id]/member-info-panel.tsx": 1,
  "src/app/app/ekip/_tabs/context.ts": 1,
  "src/app/app/gelen-kutusu/inbox-view.tsx": 1,
  "src/app/app/hedefler/page.tsx": 2,
  "src/app/app/ice-aktarma/import-wizard.tsx": 1,
  "src/app/app/ilan-havuzu/assignment-section.tsx": 1,
  "src/app/app/ilan-havuzu/page.tsx": 1,
  "src/app/app/ilan-kontrol/kapanis/page.tsx": 2,
  "src/app/app/ilan-kontrol/portallar/page.tsx": 1,
  "src/app/app/kampanyalar/[id]/page.tsx": 1,
  "src/app/app/kampanyalar/page.tsx": 1,
  "src/app/app/kiralama/[id]/charges-panel.tsx": 2,
  "src/app/app/kiralama/[id]/makbuz/[paymentId]/page.tsx": 1,
  "src/app/app/kiralama/[id]/owner-panels.tsx": 1,
  "src/app/app/kiralama/[id]/owner-tab.tsx": 1,
  "src/app/app/kiralama/[id]/page.tsx": 1,
  "src/app/app/kiralama/[id]/rent-notices-card.tsx": 2,
  "src/app/app/kiralama/page.tsx": 1,
  "src/app/app/komisyon/page.tsx": 1,
  "src/app/app/lig/page.tsx": 1,
  "src/app/app/musteriler/[id]/customer-360-tabs.tsx": 1,
  "src/app/app/musteriler/[id]/customer-satisfaction-section.tsx": 1,
  "src/app/app/ofis-kontrol/kayit/page.tsx": 2,
  "src/app/app/onaylar/page.tsx": 1,
  "src/app/app/otomasyonlar/[id]/page.tsx": 1,
  "src/app/app/otomasyonlar/page.tsx": 1,
  "src/app/app/portfoyler/[id]/page.tsx": 1,
  "src/app/app/portfoyler/[id]/property-timeline.tsx": 2,
  "src/app/app/portfoyler/[id]/sections.tsx": 1,
  "src/app/app/portfoyler/anahtarlar/page.tsx": 1,
  "src/app/app/portfoyler/sunumlar/page.tsx": 1,
  "src/app/app/projeler/[id]/page.tsx": 1,
  "src/app/app/projeler/[id]/unit-payment-plan.tsx": 1,
  "src/app/app/projeler/page.tsx": 1,
  "src/app/app/randevular/appointment-week-view.tsx": 4,
  "src/app/app/randevular/page.tsx": 3,
  "src/app/app/sozlesmeler/[id]/page.tsx": 4,
  "src/app/app/sozlesmeler/page.tsx": 1,
  "src/app/app/tavsiyeler/page.tsx": 1,
  "src/app/app/teklifler/[id]/page.tsx": 1,
  "src/app/app/teklifler/page.tsx": 1,
  "src/app/app/uyum/denetim-dosyasi/page.tsx": 1,
  "src/app/app/uyum/page.tsx": 1,
  "src/app/app/uyum/talepler/page.tsx": 1,
  "src/app/degerleme-raporu/[token]/page.tsx": 1,
  "src/app/imza/[token]/sign-panel.tsx": 1,
  "src/app/randevu-al/[token]/booking-form.tsx": 1,
  "src/app/randevu-teyit/[token]/page.tsx": 2,
  "src/app/sunum/[token]/page.tsx": 1,
  "src/app/vitrin/[slug]/[id]/page.tsx": 1,
  "src/components/listing-control/extension-wizard.tsx": 1,
  "src/components/settings/setting-field.tsx": 1,
  "src/lib/admin-format.ts": 1,
  "src/lib/ai/call-summary.ts": 1,
  "src/lib/price-history.ts": 1,
};

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** Biçim yardımcısının kendisi (timeZone sabit) taramaya girmez. */
const EXEMPT = new Set(["src/lib/format.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((abs) => ({ rel: relative(ROOT, abs).split("\\").join("/"), src: readFileSync(abs, "utf8") }));

/**
 * timeZone'suz tarih biçimleme çağrıları. Seçenekler çoğu kez alt satırlara taşar: çağrı satırı + sonraki 5 satırda
 * `timeZone` geçiyorsa saat dilimli sayılır. `toLocaleString(` sayılarda da kullanıldığından yalnız tarih alıcısında
 * (`new Date(…)`, `*_at`, `iso`) sayılır.
 */
function countTzlessDateFormatting(src: string): number {
  const lines = src.split("\n");
  let n = 0;
  lines.forEach((line, i) => {
    let kind: "dtf" | "lds" | "ls" | null = null;
    if (/Intl\.DateTimeFormat\(/.test(line)) kind = "dtf";
    else if (/toLocaleDateString\(|toLocaleTimeString\(/.test(line)) kind = "lds";
    else if (/toLocaleString\(/.test(line) && /new Date|Date\(|_at\b|\biso\b|\bIso\b/.test(line)) kind = "ls";
    if (!kind) return;
    const window = lines.slice(i, i + 6).join(" ");
    if (/timeZone/.test(window)) return;
    n += 1;
  });
  return n;
}

const LOCAL_TIME_RE = /\.(getHours|getDate|setHours|getDay|getMonth|getFullYear|setDate|getMinutes|setMinutes|setMonth|setFullYear)\(/g;

function countLocalTimeCalls(src: string): number {
  return src.match(LOCAL_TIME_RE)?.length ?? 0;
}

describe("saat dilimi sözleşmesi: timeZone'suz tarih biçimi (taban yalnız azalır)", () => {
  const actual = new Map<string, number>();
  for (const f of FILES) {
    if (EXEMPT.has(f.rel)) continue;
    const n = countTzlessDateFormatting(f.src);
    if (n > 0) actual.set(f.rel, n);
  }

  it("hiçbir dosya tabandakinden fazla timeZone'suz çağrı taşımaz (yeni çağrı: formatDateTr/formatDateTimeTr kullanın)", () => {
    const over = [...actual].filter(([file, n]) => n > (TZ_TZLESS_BASELINE[file] ?? 0)).map(([file, n]) => `${file}: ${n} > ${TZ_TZLESS_BASELINE[file] ?? 0}`);
    expect(over).toEqual([]);
  });

  it("taban yalnız var olan dosyaları listeler ve toplam üst sınırı aşmaz", () => {
    const missing = Object.keys(TZ_TZLESS_BASELINE).filter((file) => !existsSync(join(ROOT, file)));
    expect(missing).toEqual([]);
    const total = Object.values(TZ_TZLESS_BASELINE).reduce((a, b) => a + b, 0);
    // 2026-10-15 taraması: 119 çağrı (1'i sayı biçimi, sayılmaz) − SK5'in düzelttiği 3 (calls-view 2, franchise 1) = 115.
    expect(total).toBeLessThanOrEqual(115);
  });

  it("tarayıcı kendini sınar: timeZone'suz çağrıyı sayar, timeZone'lu ve sayı biçimini saymaz", () => {
    expect(countTzlessDateFormatting(`const a = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short" }).format(d);`)).toBe(1);
    expect(countTzlessDateFormatting(`const a = new Intl.DateTimeFormat("tr-TR", {\n  dateStyle: "short",\n  timeZone: "Europe/Istanbul",\n});`)).toBe(0);
    expect(countTzlessDateFormatting(`x = new Date(row.created_at).toLocaleString("tr-TR");`)).toBe(1);
    expect(countTzlessDateFormatting(`x = advisorAvg.avg.toLocaleString("tr-TR");`)).toBe(0);
    expect(countTzlessDateFormatting(`x = d.toLocaleDateString("tr-TR", { weekday: "short" });`)).toBe(1);
  });
});

describe("saat dilimi sözleşmesi: sunucu yerel saatine bağlı Date yöntemleri yalnız denetlenmiş dosyalarda", () => {
  it("her kullanım denetim listesinde ve denetlenen sayıyı aşmıyor", () => {
    const over: string[] = [];
    for (const f of FILES) {
      const n = countLocalTimeCalls(f.src);
      if (n === 0) continue;
      const allowed = TZ_LOCAL_TIME_AUDIT[f.rel]?.calls ?? 0;
      if (n > allowed) over.push(`${f.rel}: ${n} > ${allowed} (clock.ts tr* yardımcılarını kullanın ya da denetime not düşün)`);
    }
    expect(over).toEqual([]);
  });

  it("denetim kayıtları notlu, var olan dosyalara ait; 'düzeltildi' kayıtlarında yerel saat çağrısı kalmadı", () => {
    for (const [file, entry] of Object.entries(TZ_LOCAL_TIME_AUDIT)) {
      expect(existsSync(join(ROOT, file)), file).toBe(true);
      expect(entry.note.length, file).toBeGreaterThan(10);
      if (entry.verdict === "düzeltildi") {
        expect(entry.calls, file).toBe(0);
        expect(countLocalTimeCalls(readFileSync(join(ROOT, file), "utf8")), file).toBe(0);
      }
    }
    // Saha denetimi 14 dosya buldu (2026-10-15); hepsi notlu kalır.
    expect(Object.keys(TZ_LOCAL_TIME_AUDIT)).toHaveLength(14);
  });
});

describe("saat dilimi sözleşmesi: davranış (TZ ortamından bağımsız)", () => {
  it("format.ts Türkiye saatiyle biçimler: 11:00Z → 14:00, 22:01Z → ertesi gün 01:01", () => {
    expect(formatDateTimeTr("2026-10-15T11:00:00Z", { hour: "2-digit", minute: "2-digit" })).toBe("14:00");
    expect(formatDateTimeTr("2026-10-14T22:01:00Z", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })).toBe("15/10 01:01");
    expect(formatDateTr("2026-10-28T22:30:00Z", { day: "numeric", month: "long" })).toBe("29 Ekim");
  });

  it("TR 00:00–03:00 arasındaki an doğru TR gününe yazılır (UTC dilimi bir önceki günü verirdi)", () => {
    const at = "2026-10-14T22:01:00Z"; // TR 15.10 01:01
    expect(at.slice(0, 10)).toBe("2026-10-14");
    expect(trDayKey(at)).toBe("2026-10-15");
  });
});
