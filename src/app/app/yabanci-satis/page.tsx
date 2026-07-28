import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  FileCheck2,
  Globe2,
  Handshake,
  Phone,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { fetchLatestRates, formatFx, fxAgeLabel, fxApproxLine } from "@/lib/fx";
import { now } from "@/lib/clock";
import { FOREIGN_SALE_CHECKLIST, FOREIGN_SALE_GUIDE } from "@/lib/foreign-sale-checklist";
import { ApplyChecklistForm, MarkForeignForm } from "./foreign-sale-forms";

/**
 * Yabancıya satış merkezi.
 *
 * Neden var: Türkiye'de yabancıya konut satışı ayrı bir operasyon (SPK
 * değerleme raporu, askeri yasak bölge sorgusu, DAB, vatandaşlık eşiği) ve
 * sistemde hiç karşılığı yoktu. Danışman "ne gerekiyor?" sorusunu burada
 * cevaplıyor, evrak listesini tek tıkla anlaşmaya kopyalıyor.
 *
 * Kapı: modül "properties" — ayrı modül kaydı YOK, portföyün altında yaşar
 * (anahtar panosu deseniyle aynı). Giriş: /app/portfoyler araç çubuğu.
 *
 * ⚠️ Sayfadaki mevzuat bilgisi `src/lib/foreign-sale-checklist.ts` içinde ve
 * BİLGİ AMAÇLIDIR; her kartta hangi kurumdan teyit alınacağı yazılıdır.
 */

type ForeignCustomer = {
  id: string;
  full_name: string;
  phone: string | null;
  nationality: string | null;
  passport_no: string | null;
  assigned_to: string | null;
};

export default async function ForeignSalePage() {
  await requireModulePage("properties");
  const supabase = await createClient();
  const nowMs = now();
  const yearStart = `${new Date(nowMs).getUTCFullYear()}-01-01`;

  const [
    { data: foreignData },
    { data: allCustomerData },
    { data: staffData },
    { count: eligibleCount },
    { data: dealData },
    rates,
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, phone, nationality, passport_no, assigned_to")
      .eq("is_foreign", true)
      .is("deleted_at", null)
      .order("full_name")
      .limit(500),
    supabase
      .from("customers")
      .select("id, full_name, is_foreign")
      .is("deleted_at", null)
      .order("full_name")
      .limit(1000),
    supabase.from("profiles").select("id, full_name"),
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("foreign_eligible", true)
      .eq("status", "live")
      .is("deleted_at", null),
    supabase
      .from("deals")
      .select("id, stage, customer_id, deal_type, updated_at, property:properties(property_code, title), customer:customers(full_name)")
      .order("updated_at", { ascending: false })
      .limit(500),
    // Kur DB'den okunur; yoksa null döner ve döviz satırları hiç basılmaz.
    fetchLatestRates(supabase),
  ]);

  const foreignCustomers = (foreignData ?? []) as ForeignCustomer[];
  const foreignIds = foreignCustomers.map((c) => c.id);
  const staffById = new Map(
    ((staffData ?? []) as { id: string; full_name: string | null }[]).map((s) => [s.id, s.full_name]),
  );

  // Yabancı müşterilerin açık talep bütçesi — üst sınır yoksa alt sınır sayılır
  // (danışmanın elindeki en gerçekçi rakam odur). Kapanmış talepler hariç.
  let openBudgetTry = 0;
  if (foreignIds.length > 0) {
    const { data: demandData } = await supabase
      .from("customer_demands")
      .select("budget_min, budget_max, status")
      .in("customer_id", foreignIds)
      .in("status", ["new", "active", "matched"]);
    for (const d of (demandData ?? []) as { budget_min: number | null; budget_max: number | null }[]) {
      openBudgetTry += Number(d.budget_max ?? d.budget_min ?? 0);
    }
  }

  const deals = (dealData ?? []) as {
    id: string;
    stage: string;
    customer_id: string | null;
    deal_type: string | null;
    updated_at: string | null;
    property: { property_code: string; title: string | null } | { property_code: string; title: string | null }[] | null;
    customer: { full_name: string } | { full_name: string }[] | null;
  }[];

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

  const foreignIdSet = new Set(foreignIds);
  const wonThisYear = deals.filter(
    (d) =>
      d.stage === "won" &&
      d.customer_id !== null &&
      foreignIdSet.has(d.customer_id) &&
      (d.updated_at ?? "") >= yearStart,
  ).length;

  // Evrak listesi uygulanabilecek anlaşmalar — kaybedilmiş olanlar hariç.
  const openDeals = deals
    .filter((d) => d.stage !== "lost")
    .map((d) => {
      const property = one(d.property);
      const customer = one(d.customer);
      const parts = [
        customer?.full_name ?? "Müşterisiz",
        property ? property.title ?? property.property_code : "Portföysüz",
        d.deal_type === "rent" ? "Kiralama" : "Satış",
      ];
      return { id: d.id, label: parts.join(" · ") };
    })
    .slice(0, 200);

  const markableCustomers = ((allCustomerData ?? []) as { id: string; full_name: string; is_foreign: boolean }[])
    .filter((c) => !c.is_foreign)
    .map((c) => ({ id: c.id, full_name: c.full_name }));

  const rateLabel = rates ? fxAgeLabel(rates.rateDate, nowMs) : null;
  const rateTitle = rates ? `TCMB ${rates.rateDate} satış kuru — ${rateLabel}` : undefined;
  const budgetFx = fxApproxLine(openBudgetTry, rates);

  return (
    <div className="space-y-6">
      <Link
        href="/app/portfoyler"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Portföy merkezine dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-mint-500/20 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
            <Globe2 className="h-3.5 w-3.5" /> Yabancıya satış
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">
            Yabancı alıcı operasyonu
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            Zorunlu evraklar, mevzuat eşikleri ve yabancı müşteri portföyünüz tek ekranda.
            {rates ? ` Döviz karşılıkları TCMB ${rates.rateDate} satış kuruyla hesaplandı.` : ""}
          </p>
        </div>
      </section>

      {/* Yasal uyarı — mevzuat kartlarının hepsini kapsar */}
      <div className="flex items-start gap-3 rounded-[16px] border border-amber-400/40 bg-amber-400/[0.07] px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-xs leading-relaxed text-text-muted">
          <span className="font-bold text-ink-950">Bilgi amaçlıdır, hukuki tavsiye değildir.</span>{" "}
          Aşağıdaki eşik, oran ve zorunluluklar mevzuat değişiklikleriyle güncellenir. Her işlem
          öncesi ilgili <strong>Tapu Müdürlüğü</strong>, <strong>Gelir İdaresi Başkanlığı</strong> ve
          gerekiyorsa mali müşavir/avukattan <strong>resmi kaynak teyidi alınmalıdır</strong>.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Yabancı müşteri"
          value={foreignCustomers.length}
          icon={Users}
          tone="neutral"
          href="/app/yabanci-satis#yabanci-musteriler"
        />
        <StatCard
          label={budgetFx ? `Açık talep bütçesi · ${budgetFx}` : "Açık talep bütçesi"}
          value={formatFx(openBudgetTry, "TRY") ?? "—"}
          icon={Wallet}
          tone="success"
          href="/app/talepler?status=active"
        />
        <StatCard
          label="Yabancıya uygun portföy"
          value={eligibleCount ?? 0}
          icon={Building2}
          tone="neutral"
          href="/app/portfoyler?status=live"
        />
        <StatCard
          label="Kapanan anlaşma (bu yıl)"
          value={wonThisYear}
          icon={Handshake}
          tone={wonThisYear > 0 ? "success" : "warning"}
          href="/app/anlasmalar"
        />
      </div>

      {/* Mevzuat kartları */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold text-ink-950">2026 mevzuat özeti</h2>
          {rates ? (
            <span className="text-xs text-text-faint" title={rateTitle}>
              1 USD = {formatFx(rates.usd, "TRY") ?? "—"} · 1 EUR = {formatFx(rates.eur, "TRY") ?? "—"}
            </span>
          ) : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {FOREIGN_SALE_GUIDE.map((card) => (
            <article
              key={card.title}
              className="lift flex flex-col rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-brand-600/10 text-brand-600">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                {card.figure ? (
                  <span className="rounded-full bg-ink-950 px-2.5 py-1 text-[11px] font-bold text-white">
                    {card.figure}
                  </span>
                ) : null}
              </div>
              <h3 className="mt-3 font-display text-sm font-extrabold text-ink-950">{card.title}</h3>
              <p className="mt-2 flex-1 text-xs leading-relaxed text-text-muted">{card.body}</p>
              <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-text-faint">
                <span className="font-bold text-amber-600">Doğrulanmalı:</span> {card.verify}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Evrak kontrol listesi + anlaşmaya uygula */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <FileCheck2 className="h-4 w-4 text-brand-600" /> Yabancıya satış evrak listesi
            </h2>
            <p className="text-xs text-text-muted">
              {FOREIGN_SALE_CHECKLIST.length} madde ·{" "}
              {FOREIGN_SALE_CHECKLIST.filter((i) => i.required).length} zorunlu. Genel satış
              şablonunun üstüne biner; anlaşmada zaten olan maddeler tekrarlanmaz.
            </p>
          </div>
        </div>
        <div className="grid gap-x-6 gap-y-1 px-5 py-4 md:grid-cols-2">
          {FOREIGN_SALE_CHECKLIST.map((item, i) => (
            <div key={item.label} className="flex items-start gap-2.5 border-b border-line/60 py-2 last:border-0">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-canvas text-[10px] font-bold text-text-faint">
                {i + 1}
              </span>
              <span className="flex-1 text-sm text-ink-950">{item.label}</span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  item.required ? "bg-danger-500/10 text-danger-600" : "bg-canvas text-text-faint"
                }`}
              >
                {item.required ? "Zorunlu" : "Duruma bağlı"}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-line bg-canvas/50 px-5 py-4">
          <p className="mb-2 text-xs font-semibold text-text-muted">Bu listeyi bir anlaşmaya uygula</p>
          <ApplyChecklistForm deals={openDeals} itemCount={FOREIGN_SALE_CHECKLIST.length} />
        </div>
      </section>

      {/* Yabancı müşteriler */}
      <section
        id="yabanci-musteriler"
        className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Globe2 className="h-4 w-4 text-brand-600" /> Yabancı müşteriler
            </h2>
            <p className="text-xs text-text-muted">{foreignCustomers.length} kayıt</p>
          </div>
        </div>

        {foreignCustomers.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState
              icon={Globe2}
              title="Henüz yabancı müşteri işaretlenmedi"
              description="Yabancı uyruklu alıcılarınızı işaretleyin; talep bütçeleri döviz karşılığıyla burada toplansın ve evrak akışı ayrışsın."
              tone="brand"
            />
          </div>
        ) : (
          <div className="divide-y divide-line">
            {foreignCustomers.map((c) => (
              <Link
                key={c.id}
                href={`/app/musteriler/${c.id}`}
                className="group grid gap-2 px-5 py-3.5 transition hover:bg-brand-600/[0.02] lg:grid-cols-[1.4fr_.8fr_.8fr_.9fr_auto] lg:items-center"
              >
                <p className="truncate text-sm font-semibold text-ink-950 transition group-hover:text-brand-600">
                  {c.full_name}
                </p>
                <p className="flex items-center gap-1.5 text-xs text-text-muted">
                  <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                  {c.nationality ?? "Uyruk girilmedi"}
                </p>
                <p className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  {c.phone ?? "—"}
                </p>
                <p className="truncate text-xs text-text-muted">
                  {c.assigned_to ? staffById.get(c.assigned_to) ?? "Danışman" : "Atanmadı"}
                </p>
                <ArrowUpRight className="hidden h-4 w-4 justify-self-end text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100 lg:block" />
              </Link>
            ))}
          </div>
        )}

        <div className="border-t border-line bg-canvas/50 px-5 py-4">
          <p className="mb-2 text-xs font-semibold text-text-muted">Müşteriyi yabancı olarak işaretle</p>
          <MarkForeignForm customers={markableCustomers} />
        </div>
      </section>
    </div>
  );
}
