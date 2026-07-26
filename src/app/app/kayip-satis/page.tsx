import Link from "next/link";
import { now as nowMs } from "@/lib/clock";
import {
  AlarmClock, AlertTriangle, ClipboardPlus, MessageCircle, Phone, PhoneCall, TrendingDown, Zap,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { detectLostSaleRisks, estimateLostRevenue } from "@/lib/lost-sale-detector";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
import { dismissLostSaleRisk } from "./actions";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

const DAY = 86_400_000;

export default async function KayipSatisPage() {
  const ctx = await requireModulePage("customers");
  const detected = await detectLostSaleRisks(50);

  // Snooze/arandı filtresi: dismissed_until gelecekte olanlar ve son 30 günde
  // "called" işaretlenenler listeden düşer (bkz. lost_sale_dismissals).
  const supabase = await createClient();
  const { data: dismissals } = await supabase
    .from("lost_sale_dismissals")
    .select("customer_id, dismissed_until, reason, created_at")
    .eq("tenant_id", ctx.tenantId);

  const now = nowMs();
  const dismissedIds = new Set(
    (dismissals ?? [])
      .filter((d) =>
        (d.dismissed_until != null && new Date(d.dismissed_until).getTime() > now) ||
        (d.reason === "called" && now - new Date(d.created_at).getTime() < 30 * DAY),
      )
      .map((d) => d.customer_id),
  );

  const risks = detected.filter((r) => !dismissedIds.has(r.id));
  const hiddenCount = detected.length - risks.length;
  const estLost = estimateLostRevenue(risks);

  const critical = risks.filter((r) => r.urgency === "critical");
  const warning  = risks.filter((r) => r.urgency === "warning");

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-red-500/25 blur-[90px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-red-300">
              <TrendingDown className="h-4 w-4" /> Kayıp satış dedektörü
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">
              Risk Altındaki Müşteriler
            </h1>
            <p className="mt-1 max-w-lg text-sm text-white/75">
              Uzun süredir iletişim kurulmamış, portföy gönderilmemiş veya
              hareketsiz kalan müşteriler. Hemen arayın, kayıp önleyin.
            </p>
          </div>
          {/* KPI'lar ilgili bölüm çapalarına iner */}
          <div className="flex gap-3">
            <Link
              href="#kritik"
              className="focus-ring press lift block rounded-[14px] border border-white/12 bg-white/8 p-3 text-center hover:border-white/30"
            >
              <p className="font-display text-2xl font-extrabold text-red-400">{critical.length}</p>
              <p className="text-[11px] text-white/70">Kritik</p>
            </Link>
            <Link
              href="#uyari"
              className="focus-ring press lift block rounded-[14px] border border-white/12 bg-white/8 p-3 text-center hover:border-white/30"
            >
              <p className="font-display text-2xl font-extrabold text-amber-400">{warning.length}</p>
              <p className="text-[11px] text-white/70">Uyarı</p>
            </Link>
            <Link
              href="#kritik"
              className="focus-ring press lift block rounded-[14px] border border-white/12 bg-white/8 p-3 text-center hover:border-white/30"
            >
              <p className="font-display text-lg font-extrabold text-white">{money(estLost)}</p>
              <p className="text-[11px] text-white/70">Tahmini kayıp</p>
            </Link>
          </div>
        </div>
      </section>

      {hiddenCount > 0 ? (
        <p className="rounded-[12px] border border-line bg-surface px-4 py-2.5 text-xs text-text-muted">
          {hiddenCount} müşteri &quot;arandı&quot; veya ertelendiği için gizlendi.
        </p>
      ) : null}

      {risks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[20px] border border-emerald-200 bg-emerald-50 py-16 text-center">
          <Zap className="h-12 w-12 text-emerald-500" />
          <h3 className="mt-3 text-lg font-bold text-emerald-900">Mükemmel! Risk yok</h3>
          <p className="mt-1 text-sm text-emerald-700">
            Tüm aktif müşterileriniz düzenli takip altında.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Kritik */}
          {critical.length > 0 && (
            <section id="kritik" className="scroll-mt-24">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-red-600">
                <AlertTriangle className="h-4 w-4" /> Kritik — Hemen ara
              </h2>
              <div className="space-y-2">
                {critical.map((r) => (
                  <RiskCard key={r.id} risk={r} />
                ))}
              </div>
            </section>
          )}

          {/* Uyarı */}
          {warning.length > 0 && (
            <section id="uyari" className="scroll-mt-24">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-600">
                <AlertTriangle className="h-4 w-4" /> Uyarı — Bu hafta ara
              </h2>
              <div className="space-y-2">
                {warning.map((r) => (
                  <RiskCard key={r.id} risk={r} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function RiskCard({ risk }: { risk: Awaited<ReturnType<typeof detectLostSaleRisks>>[0] }) {
  const initials = risk.full_name
    .split(" ")
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isCritical = risk.urgency === "critical";

  return (
    <div className={`flex items-center gap-3 rounded-[16px] border px-4 py-3 transition hover:bg-canvas/60 ${
      isCritical ? "border-red-200 bg-red-50/50" : "border-amber-200 bg-amber-50/40"
    }`}>
      {/* Avatar */}
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${
        isCritical ? "bg-red-500" : "bg-amber-500"
      }`}>
        {initials}
      </span>

      {/* Bilgi */}
      <div className="min-w-0 flex-1">
        <Link
          href={`/app/musteriler/${risk.id}`}
          className="font-semibold text-ink-950 hover:text-brand-600 hover:underline"
        >
          {risk.full_name}
        </Link>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
          <AlertTriangle className={`h-3 w-3 ${isCritical ? "text-red-500" : "text-amber-500"}`} />
          {risk.reasonLabel}
        </p>
        {risk.phone && (
          <p className="mt-0.5 text-[11px] text-text-faint">{formatTurkishPhone(risk.phone)}</p>
        )}
      </div>

      {/* Aksiyonlar */}
      <div className="flex shrink-0 items-center gap-1.5">
        {risk.phone && (
          <>
            <a
              href={toTelHref(risk.phone) ?? "#"}
              className="grid h-8 w-8 place-items-center rounded-[8px] border border-line bg-surface text-brand-600 transition hover:bg-brand-600/5"
              title="Ara"
              aria-label="Ara"
            >
              <Phone className="h-3.5 w-3.5" />
            </a>
            <a
              href={toWhatsAppLink(risk.phone) ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="grid h-8 w-8 place-items-center rounded-[8px] border border-line bg-surface text-emerald-600 transition hover:bg-emerald-50"
              title="WhatsApp"
              aria-label="WhatsApp"
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </a>
          </>
        )}
        {/* Arandı: 30 gün listeden düşer. Kutu işaretliyse (varsayılan) calls
            tablosuna outbound + "Ulaşıldı" kaydı da atılır — müşteri zaman
            tüneline düşer. Telefonu olmayan müşteride kutu gösterilmez. */}
        <form action={dismissLostSaleRisk} className="flex items-center gap-1.5">
          <input type="hidden" name="customer_id" value={risk.id} />
          <input type="hidden" name="reason" value="called" />
          {risk.phone ? (
            <>
              <input type="hidden" name="phone" value={risk.phone} />
              <label
                className="flex cursor-pointer items-center gap-1 text-[11px] text-text-muted"
                title="İşaretliyse görüşme, çağrı geçmişine ve müşteri zaman tüneline de yazılır"
              >
                <input
                  type="checkbox"
                  name="log_call"
                  value="1"
                  defaultChecked
                  className="h-3.5 w-3.5 rounded border-line accent-brand-600"
                />
                Çağrı olarak da kaydet
              </label>
            </>
          ) : null}
          <button
            type="submit"
            className="focus-ring press inline-flex items-center gap-1 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-mint-600 transition hover:bg-mint-500/10"
            title="Arandı olarak işaretle (30 gün listeden düşer)"
          >
            <PhoneCall className="h-3.5 w-3.5" /> Arandı ✓
          </button>
        </form>
        {/* Ertele: 7 gün sonra tekrar listeye döner */}
        <form action={dismissLostSaleRisk}>
          <input type="hidden" name="customer_id" value={risk.id} />
          <input type="hidden" name="reason" value="snoozed" />
          <button
            type="submit"
            className="focus-ring press inline-flex items-center gap-1 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-amber-600 transition hover:bg-amber-50"
            title="1 hafta sonra tekrar hatırlat"
          >
            <AlarmClock className="h-3.5 w-3.5" /> 1 hafta ertele
          </button>
        </form>
        {/* Takip görevini görevler ekranında aç */}
        <Link
          href="/app/gorevler"
          className="focus-ring press inline-flex items-center gap-1 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition hover:bg-canvas hover:text-ink-950"
          title="Takip görevi oluştur"
        >
          <ClipboardPlus className="h-3.5 w-3.5" /> Görev oluştur
        </Link>
        <Link
          href={`/app/musteriler/${risk.id}`}
          className="inline-flex items-center gap-1 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-brand-600 transition hover:bg-brand-600/5"
        >
          Kart
        </Link>
      </div>
    </div>
  );
}
