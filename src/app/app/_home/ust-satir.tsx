import Link from "next/link";
import { Phone, Plus, Receipt, Tv } from "lucide-react";
import { PeriodToggle, type Period } from "@/components/ui/premium";
import { now, trParts } from "@/lib/clock";
import { cn } from "@/lib/utils";
import { WidgetEditToggle } from "../dashboard-widgets";
import type { HomeCtx } from "./data";
import { greetingFor } from "./helpers";
import type { HomeLayout } from "./home-layout";
import { homeHref, type HomeParams } from "./kapsam-anahtari";
import { PaletDugme } from "./palet-dugme";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

/** "6 Ekim Salı" — Türkiye saatine göre (clock.ts). */
export function dateLine(nowMs: number): string {
  const p = trParts(nowMs);
  return `${p.day} ${MONTHS[p.month]} ${WEEKDAYS[p.weekday]}`;
}

const QUICK: Record<HomeLayout["variant"], { href: string; label: string; Icon: typeof Plus }> = {
  management: { href: "/app/musteriler/yeni", label: "Müşteri", Icon: Plus },
  advisor: { href: "/app/musteriler/yeni", label: "Müşteri", Icon: Plus },
  team_lead: { href: "/app/musteriler/yeni", label: "Müşteri", Icon: Plus },
  accounting: { href: "/app/komisyon?durum=bekleyen", label: "Komisyonlar", Icon: Receipt },
  call_center: { href: "/app/arama", label: "Aramalar", Icon: Phone },
};

/**
 * İnce başlık satırı (~64px): "Günaydın <ad> · <tarih>" + dönem (7|30|90, URL ?donem=) + Ofis|Ben + hızlı eylem + ⌘K.
 * Karar notu: gece-şehri hero'su ve cam KPI'lar /app'ten kaldırıldı (marka sahibi onaylamadı); metrikler
 * `metrik-seridi.tsx`'te bağlamlı olarak tek kez gösterilir.
 */
export function UstSatir({
  ctx,
  layout,
  params,
  officeView,
  hasName,
}: {
  ctx: HomeCtx;
  layout: HomeLayout;
  params: HomeParams;
  officeView: boolean;
  hasName: boolean;
}) {
  const nowMs = now();
  const greeting = greetingFor(trParts(nowMs).hour);
  const quick = QUICK[layout.variant];
  const seg = "focus-ring press";
  return (
    <header className="pm-top" aria-label="Ana ekran başlığı">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-bold leading-7 text-ink-950 sm:text-2xl sm:leading-8">
          {greeting}
          {hasName ? <span className="pm-money"> {ctx.firstName}</span> : null}
          <span className="ml-2 text-sm font-medium text-text-muted sm:ml-3 sm:text-base">· {dateLine(nowMs)}</span>
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {layout.periodToggle ? (
          <PeriodToggle current={ctx.period as Period} basePath="/app" params={{ kapsam: params.kapsam, daha: params.daha }} label="Özet dönemi" />
        ) : null}
        {layout.scopeSwitch ? (
          <nav aria-label="Ana ekran kapsamı" className="pm-seg">
            <Link href={homeHref(params, { kapsam: "ofis" })} scroll={false} aria-current={officeView ? "true" : undefined} className={seg}>
              Ofis
            </Link>
            <Link href={homeHref(params, { kapsam: undefined })} scroll={false} aria-current={officeView ? undefined : "true"} className={seg}>
              Ben
            </Link>
          </nav>
        ) : null}
        <Link
          href={quick.href}
          className={cn(
            "focus-ring press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-bold text-[#1a1200]",
            "bg-[linear-gradient(135deg,var(--gold-300),var(--gold-400))] hover:brightness-105",
          )}
        >
          <quick.Icon className="h-4 w-4" aria-hidden="true" />
          {quick.label}
        </Link>
        <PaletDugme />
        <WidgetEditToggle className="border-line bg-surface text-text-muted hover:bg-surface-hover" />
        {layout.variant === "management" ? (
          <Link
            href="/app/pano-tv"
            title="TV modu — büyük ekran görünümü"
            aria-label="TV modunu aç"
            className="focus-ring press grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:bg-surface-hover"
          >
            <Tv className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </header>
  );
}
