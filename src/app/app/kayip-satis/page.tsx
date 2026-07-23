import Link from "next/link";
import {
  AlertTriangle, Phone, TrendingDown, UserX, Zap,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { detectLostSaleRisks, estimateLostRevenue } from "@/lib/lost-sale-detector";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

export default async function KayipSatisPage() {
  await requireModulePage("customers");
  const risks = await detectLostSaleRisks(50);
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
          <div className="flex gap-3">
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <p className="font-display text-2xl font-extrabold text-red-400">{critical.length}</p>
              <p className="text-[10px] text-white/70">Kritik</p>
            </div>
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <p className="font-display text-2xl font-extrabold text-amber-400">{warning.length}</p>
              <p className="text-[10px] text-white/70">Uyarı</p>
            </div>
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <p className="font-display text-lg font-extrabold text-white">{money(estLost)}</p>
              <p className="text-[10px] text-white/70">Tahmini kayıp</p>
            </div>
          </div>
        </div>
      </section>

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
            <section>
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
            <section>
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
              <UserX className="h-3.5 w-3.5" />
            </a>
          </>
        )}
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
