import Link from "next/link";
import { PERIODS, parsePeriod, periodHref, type Period } from "./premium-math";

/**
 * PeriodToggle — 7 / 30 / 90 gün segment seçici. URL ?donem= ile İKİ YÖNLÜ (filtre
 * kontratı): sayfa `searchParams.donem` değerini `parsePeriod` ile okuyup sunucu
 * sorgusuna uygular; bu bileşen yalnız bağlantı üretir (istemci JS yok, geri/ileri
 * ve paylaşılan bağlantı çalışır). Diğer sorgu parametreleri korunur.
 *
 * Kullanım: <PeriodToggle current={period} basePath="/admin" params={sp} />
 * Yalnız seçimin GERÇEKTEN veriyi etkilediği ekranlarda göster.
 */
export function PeriodToggle({
  current,
  basePath,
  params = {},
  label = "Dönem",
}: {
  current: Period | string | undefined;
  basePath: string;
  /** Mevcut searchParams (donem dışındakiler bağlantılara taşınır). */
  params?: Record<string, string | undefined>;
  label?: string;
}) {
  const active = typeof current === "number" ? current : parsePeriod(current);
  return (
    <nav aria-label={`${label} seçici`} className="pm-seg">
      {PERIODS.map((p) => (
        <Link
          key={p}
          href={periodHref(basePath, params, p)}
          scroll={false}
          aria-current={p === active ? "true" : undefined}
        >
          {p} gün
        </Link>
      ))}
    </nav>
  );
}
