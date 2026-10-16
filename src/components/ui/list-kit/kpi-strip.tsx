import type { ReactNode } from "react";
import { formatCount } from "@/lib/ui/filter-params";
import { cn } from "@/lib/utils";
import { KpiGrid } from "@/components/ui/dashboard-grid";
import { KpiTile } from "@/components/ui/premium/kpi-card";
import { KPI_CAP_DESKTOP, KpiCap } from "@/components/ui/simple-kit";
import type { PremiumTone, Trend } from "@/components/ui/premium/premium-math";
import { hasSeries, trendOf } from "./list-logic";
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
};

const TONE_MAP: Record<PillTone, PremiumTone> = {
  success: "success",
  warning: "warn",
  danger: "danger",
  info: "brand",
  neutral: "neutral",
};

/** Liste mantığındaki sade trendi ortak `Trend` biçimine çevirir (yeni / düz / yön). */
function toTrend(t: { dir: "up" | "down" | "flat"; pct: number | null; label: string }): Trend {
  if (t.pct === null && t.dir === "up") return { dir: "new", label: "yeni", pct: null, good: null, sr: "Önceki dönemde kayıt yoktu, yeni" };
  if (t.dir === "flat") return { dir: "flat", label: t.label, pct: 0, good: null, sr: "Önceki döneme göre değişmedi" };
  return {
    dir: t.dir,
    label: t.label,
    pct: t.pct,
    good: t.dir === "up",
    sr: `Önceki döneme göre yüzde ${Math.abs(t.pct ?? 0)} ${t.dir === "up" ? "arttı" : "azaldı"}`,
  };
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
  const primary = mobilePrimary(items);
  const deskPrimary = mobilePrimary(items, KPI_CAP_DESKTOP);
  const capped = items.length > KPI_CAP_DESKTOP;
  return (
    <KpiCap count={items.length}>
      <KpiGrid count={items.length} label={label} className={cn("kpi-compact", capped && "kpi-capped", className)}>
        {items.map((it, i) => {
          const zero = it.value === 0 || it.value === "0";
          const shown = typeof it.value === "number" ? formatCount(it.value) : it.value;
          const series = hasSeries(it.series) ? it.series : null;
          const t = series && it.showTrend ? trendOf(series) : null;
          return (
            <KpiTile
              key={`${it.label}-${it.href}`}
              label={it.label}
              value={shown}
              href={it.href}
              title={it.title}
              iconNode={it.icon}
              tone={TONE_MAP[it.tone ?? "info"]}
              trend={t ? toTrend(t) : undefined}
              previousText={t ? (it.seriesLabel ?? "önceki döneme göre") : undefined}
              hint={t ? undefined : it.hint}
              attention={Boolean(it.attention) && !zero}
              dim={zero && !it.attention}
              className={cn(zero && !it.attention && "kpi-zero", !primary.has(i) && "kpi-more", !deskPrimary.has(i) && "kpi-more-d")}
              series={series ?? undefined}
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
