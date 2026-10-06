import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Phone, Plus, Receipt, Tv } from "lucide-react";
import { DashboardHero } from "@/components/ui/dashboard-hero";
import { DataFreshness } from "@/components/ui/data-freshness";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ScopeSwitch } from "@/components/ui/scope-switch";
import { PERIODS } from "@/components/ui/premium";
import { now, trParts } from "@/lib/clock";
import { WidgetEditToggle } from "../dashboard-widgets";
import { loadAttention, type HomeCtx } from "./data";
import { greetingFor } from "./helpers";
import { heroContextLabel, type HomeLayout } from "./home-layout";
import { heroFocus } from "./home-metrics";
import { homeHref, type HomeParams } from "./kapsam-anahtari";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

/** "6 EKİM SALI · OFİS GÖRÜNÜMÜ" — Türkiye saatine göre (clock.ts). */
function eyebrowOf(nowMs: number, context: string): string {
  const p = trParts(nowMs);
  return `${p.day} ${MONTHS[p.month]} ${WEEKDAYS[p.weekday]} · ${context}`.toLocaleUpperCase("tr-TR");
}

const QUICK: Record<HomeLayout["variant"], { href: string; label: string; Icon: typeof Plus }> = {
  management: { href: "/app/musteriler/yeni", label: "Müşteri", Icon: Plus },
  advisor: { href: "/app/musteriler/yeni", label: "Müşteri", Icon: Plus },
  team_lead: { href: "/app/musteriler/yeni", label: "Müşteri", Icon: Plus },
  accounting: { href: "/app/komisyon?durum=bekleyen", label: "Komisyonlar", Icon: Receipt },
  call_center: { href: "/app/arama", label: "Aramalar", Icon: Phone },
};

/**
 * Hero özeti: TEK cümle, KPI'ları tekrarlamaz; en öncelikli işi adıyla ve bağlantısıyla söyler (`loadAttention`,
 * Dikkat listesiyle aynı kaynak). Ayrı Suspense: KPI/blok akışını bekletmez.
 */
async function HeroOzet({ ctx }: { ctx: HomeCtx }) {
  const items = await loadAttention(ctx).catch(() => []);
  const f = heroFocus(items);
  return (
    <p>
      {f.lead}{" "}
      <Link href={f.href} className="focus-ring inline-flex items-center gap-1 rounded-sm font-semibold text-[var(--accent-text)] hover:underline">
        {f.text}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
      {f.rest > 0 ? <span> · {f.rest} konu daha dikkat bekliyor.</span> : null}
    </p>
  );
}

const iconBtn =
  "focus-ring press grid h-9 w-9 touch:h-11 touch:w-11 place-items-center rounded-full border border-hairline bg-surface-raised text-text-muted shadow-[var(--elev-1)] transition hover:bg-surface-hover";

/**
 * ANA EKRAN HERO (tasarım sistemi v4 `DashboardHero`, /admin kontrol paneliyle aynı dil): tarih + rol bağlamı satırı,
 * rol bazlı selamlama (tek h1), tek cümle öncelik, tazelik damgası; sağ üstte AYNI HİZADA yönetimde kapsam geçişi
 * (`ScopeSwitch`: Ofis geneli | Benim işlerim, URL ?kapsam= + son seçim çerezi) ve dönem seçici (7|30|90, URL ?donem=);
 * altında hızlı eylemler. Komut araması üst çubukta (Ctrl K) olduğu için burada yok.
 */
export function AnaHero({ ctx, layout, params, officeView, hasName }: { ctx: HomeCtx; layout: HomeLayout; params: HomeParams; officeView: boolean; hasName: boolean }) {
  const nowMs = now();
  const quick = QUICK[layout.variant];
  return (
    <DashboardHero
      eyebrow={eyebrowOf(nowMs, heroContextLabel(layout, officeView))}
      title={`${greetingFor(trParts(nowMs).hour)}${hasName ? `, ${ctx.firstName}` : ""}`}
      summary={
        <Suspense fallback={<p>Günün önceliği hazırlanıyor…</p>}>
          <HeroOzet ctx={ctx} />
        </Suspense>
      }
      freshness={<DataFreshness asOf={nowMs} />}
      aside={
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          <div className="flex w-full flex-wrap items-start gap-2 sm:w-auto sm:justify-end">
            {layout.scopeSwitch ? (
              <ScopeSwitch
                label="Ana ekran kapsamı"
                value={officeView ? "ofis" : "ben"}
                office={{ href: homeHref(params, { kapsam: "ofis" }), hint: "Ofisin tüm danışmanları ve kayıtları" }}
                mine={{ href: homeHref(params, { kapsam: "ben" }), hint: "Yalnız size atanmış kayıtlar" }}
              />
            ) : null}
            {layout.periodToggle ? (
              <SegmentedControl
                label="Özet dönemi"
                value={String(ctx.period)}
                options={PERIODS.map((p) => ({ value: String(p), label: `${p} gün`, href: homeHref(params, { donem: p === 30 ? undefined : String(p) }) }))}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={quick.href}
              className="focus-ring press inline-flex h-9 touch:h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg shadow-[var(--elev-1)] transition hover:brightness-110"
            >
              <quick.Icon className="h-4 w-4" aria-hidden="true" />
              {quick.label}
            </Link>
            <WidgetEditToggle className="h-9 touch:h-11 rounded-full border-hairline bg-surface-raised text-text-muted hover:bg-surface-hover" />
            {layout.variant === "management" ? (
              <Link href="/app/pano-tv" title="TV modu — büyük ekran görünümü" aria-label="TV modunu aç" className={iconBtn}>
                <Tv className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </div>
      }
    />
  );
}
