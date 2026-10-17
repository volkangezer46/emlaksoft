import type { ReactNode } from "react";
import { formatCount } from "@/lib/ui/filter-params";
import { cn } from "@/lib/utils";
import { KpiGrid } from "@/components/ui/dashboard-grid";
import { KpiTile } from "@/components/ui/premium/kpi-card";
import { KpiCap } from "@/components/ui/kpi-cap";
import { KPI_CAP_DESKTOP } from "@/components/ui/kpi-cap-limits";
import type { PremiumTone, Trend } from "@/components/ui/premium/premium-math";
import { hasSeries, trendOf, type Trend as ListTrend } from "./list-logic";
import type { PillTone } from "./status-pill";

/**
 * KpiStrip — tıklanabilir KPI kartları (görünüm `KpiTile` ile tek uygulama; StatCard/KpiCard ile aynı kart) (sıfır çıkmaz metrik: `href` zorunlu).
 *
 * GERÇEK VERİ KURALI: `series` (eskiden yeniye sayılar, ör. haftalık yeni kayıt) yalnız
 * gerçek kayıtlardan hesaplandığında verilir. Verilirse mini renkli çubuklar ve (isteğe bağlı
 * `showTrend`) trend oku çizilir; verilmezse / hepsi sıfırsa kart sade kalır — sahte çubuk yok.
 * `attention`: sıfır değilse değer kırmızıya döner (örn. fiyat uyarısı).
 *
 * DENGELİ GÖRÜNÜM (varsayılan; sahip kararı 2026-10-16): şerit GÖRÜNÜR (katlanmaz). Masaüstünde en çok 6 kart
 * (`kpi-more-d` dışındakiler), telefonda (<640 px) en çok 2 kart, 2 sütun, etiket görünür ve sayı kesilmez
 * (premium.css `.kpi-compact`); kalan kartlar "Tüm göstergeler (n)" ile açılır (`KpiCap`). Gösterilecek kartlar
 * `mobilePrimary` ile seçilir (önce sıfır olmayan). Tam modda masaüstünde hepsi, telefonda yine 2 kart.
 *
 * İNCE ŞERİT (karşılaştırma raporu P1 9): liste sayfasının asıl işi listedir. Geniş ekranda (≥640 px, yükseklik >500 px)
 * her gösterge ~56 px'lik tek satırlık hap olarak çizilir (list-page.css `.lk-kpi-thin`): ikon + etiket üstte, değer +
 * trend altta; GERÇEK seri varsa sağ kenarda 28 px mini çubuklar (WP3). Alt açıklama fare üstü ipucuna (`title`) taşınır.
 * 1366×768'de Müşteriler/Portföyler/Talepler/Görevler listesinin ilk 5 satırı ilk ekranda kalır.
 *
 * SÜZGEÇ KARTLARI (WP3, tek desen): liste sayfasında KPI kartları aynı zamanda durum süzgecidir — kart, süzgeçli listeye
 * gider ve etkin süzgecin kartı `active` ile işaretlenir (`aria-current`, `.pm-card-on`). Aynı kümeyi tekrar eden ikinci bir
 * çip satırı ÇİZİLMEZ. Telefonda (<640 px) tüm kartlar tek satırlık, yatay kayan dokunulabilir süzgeç şerididir
 * ("Tüm göstergeler" anahtarı yok).
 *
 * TREND: rozet yalnız gerçek seriden ve önceki dönemde kayıt varken çizilir; önceki dönem boşsa ("yeni") rozet yoktur.
 */
export type KpiItem = {
  label: string;
  value: number | string;
  href: string;
  icon: ReactNode;
  tone?: PillTone;
  /** Değerin altındaki kısa gerçek bilgi ("bu ay", "15 portföy"). */
  hint?: string;
  series?: readonly number[];
  /** Seriden trend oku hesapla (son yarı / önceki yarı). */
  showTrend?: boolean;
  /** Seri/trend etiketi için pencere açıklaması ("son 4 hafta"). */
  seriesLabel?: string;
  attention?: boolean;
  /** Fare üstü açıklaması (ör. döviz karşılığı kaynağı). */
  title?: string;
  /** Süzgeç kartı: bu kartın süzgeci şu an etkin. */
  active?: boolean;
};

const TONE_MAP: Record<PillTone, PremiumTone> = {
  success: "success",
  warning: "warn",
  danger: "danger",
  info: "brand",
  neutral: "neutral",
};

/**
 * Liste mantığındaki sade trendi ortak `Trend` biçimine çevirir. Önceki dönemde kayıt yoksa ("yeni") rozet ÇİZİLMEZ (null):
 * "yeni" sözcüğü kayıt durumu "Yeni" ile karışıyordu (isleyis P2-3) ve kıyas olmadan trend yoktur.
 */
export function kpiTrend(t: ListTrend | null): Trend | null {
  if (!t || t.label === "yeni") return null;
  if (t.dir === "flat") return { dir: "flat", label: t.label, pct: 0, good: null, sr: "Önceki döneme göre değişmedi" };
  return { dir: t.dir, label: t.label, pct: t.pct === null ? null : Math.abs(t.pct), good: t.dir === "up", sr: `Önceki döneme göre ${t.spoken}` };
}

/** Telefonda gösterilecek en çok 2 kartın dizini: önce sıfır olmayan (ya da dikkat isteyen), yoksa ilk kartlar. */
export function mobilePrimary(items: readonly Pick<KpiItem, "value" | "attention">[], max = 2): Set<number> {
  const isZero = (v: number | string) => v === 0 || v === "0";
  const picked: number[] = [];
  items.forEach((it, i) => {
    if (picked.length < max && (!isZero(it.value) || it.attention)) picked.push(i);
  });
  for (let i = 0; i < items.length && picked.length < max; i++) if (!picked.includes(i)) picked.push(i);
  return new Set(picked);
}

export function KpiStrip({ items, label = "Özet göstergeler", className }: { items: readonly KpiItem[]; label?: string; className?: string }) {
  const deskPrimary = mobilePrimary(items, KPI_CAP_DESKTOP);
  const capped = items.length > KPI_CAP_DESKTOP;
  return (
    <KpiCap count={items.length} phoneCap={false}>
      <KpiGrid count={items.length} label={label} className={cn("kpi-compact lk-kpi-thin", capped && "kpi-capped", className)}>
        {items.map((it, i) => {
          const zero = it.value === 0 || it.value === "0";
          const shown = typeof it.value === "number" ? formatCount(it.value) : it.value;
          const series = hasSeries(it.series) ? it.series : null;
          const t = series && it.showTrend ? kpiTrend(trendOf(series)) : null;
          // İnce şeritte alt açıklama görünmez: kartın ipucu etiket + açıklama + (varsa) özel ipucu olur.
          const tip = [it.hint && !t ? `${it.label}: ${it.hint}` : null, it.title].filter(Boolean).join(" · ") || undefined;
          return (
            <KpiTile
              key={`${it.label}-${it.href}`}
              label={it.label}
              value={shown}
              href={it.href}
              title={tip}
              iconNode={it.icon}
              tone={TONE_MAP[it.tone ?? "info"]}
              trend={t ?? undefined}
              previousText={t ? (it.seriesLabel ?? "önceki döneme göre") : undefined}
              hint={t ? undefined : it.hint}
              attention={Boolean(it.attention) && !zero}
              dim={zero && !it.attention}
              className={cn(zero && !it.attention && "kpi-zero", !deskPrimary.has(i) && "kpi-more-d")}
              current={Boolean(it.active)}
              series={series ?? undefined}
              chartHeight={28}
              chart="bars"
              seriesUnit={it.seriesLabel}
              seriesLabel={series ? `${it.seriesLabel ?? "Seri"}: ${series.join(", ")}` : undefined}
            />
          );
        })}
      </KpiGrid>
    </KpiCap>
  );
}
