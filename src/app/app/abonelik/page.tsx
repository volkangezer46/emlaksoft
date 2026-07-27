import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Check,
  Contact2,
  CreditCard,
  Gauge,
  Sparkles,
  ShieldCheck,
  Users2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { DAY_MS, msUntil } from "@/lib/clock";
import { PLANS, planAmountTry, planLabel, type BillingCycle } from "@/lib/billing/plans";
import { isIyzicoConfigured } from "@/lib/billing/iyzico";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CheckoutButton } from "./checkout-button";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

const statusLabel: Record<string, string> = {
  trialing: "Deneme",
  active: "Aktif",
  past_due: "Gecikmiş",
  cancelled: "İptal",
  paused: "Duraklatıldı",
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string; demo?: string; plan?: string; error?: string; cycle?: string }>;
}) {
  await requireModulePage("billing");
  const sp = await searchParams;
  const cycle = (sp.cycle === "yearly" ? "yearly" : "monthly") as BillingCycle;
  const supabase = await createClient();
  const configured = isIyzicoConfigured();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = user?.app_metadata?.tenant_id as string | undefined;

  const [
    { data: tenant },
    { data: sub },
    { data: invoices },
    { count: memberCount },
    { count: propertyCount },
    { count: customerCount },
  ] = await Promise.all([
    tenantId
      ? supabase.from("tenants").select("id, name, plan, status").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
    tenantId
      ? supabase
          .from("subscriptions")
          .select("plan, status, billing_cycle, amount_try, trial_ends_at, current_period_end")
          .eq("tenant_id", tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    tenantId
      ? supabase
          .from("invoices")
          .select("id, invoice_no, status, total_try, paid_at, created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
    tenantId
      ? supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)
      : Promise.resolve({ count: null }),
    // Kullanım göstergeleri — gerçek kayıt sayıları (RLS tenant kapsamında)
    supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
  ]);

  const currentPlan = sub?.plan ?? tenant?.plan ?? "office";

  /**
   * Kullanım göstergeleri — plan tanımlarında yapısal kayıt limiti YOK;
   * tek sayısal sınır Danışman paketinin "1 kullanıcı" özelliği (PLANS).
   * Limitli metrikte doluluk çubuğu, limitsizde yalnız gerçek sayım gösterilir.
   */
  const USER_LIMIT_BY_PLAN: Partial<Record<string, number>> = { advisor: 1 };
  const userLimit = USER_LIMIT_BY_PLAN[currentPlan] ?? null;
  const usage = [
    { label: "Kullanıcı", value: memberCount ?? 0, limit: userLimit, icon: Users2, href: "/app/ekip", tone: "text-brand-600 bg-brand-600/10" },
    { label: "Portföy kaydı", value: propertyCount ?? 0, limit: null, icon: Building2, href: "/app/portfoyler", tone: "text-mint-600 bg-mint-500/10" },
    { label: "Müşteri kaydı", value: customerCount ?? 0, limit: null, icon: Contact2, href: "/app/musteriler", tone: "text-amber-600 bg-amber-400/10" },
  ];

  // Deneme geri sayımı — yalnızca trialing durumunda anlamlı
  const trialEnds = sub?.trial_ends_at ? new Date(sub.trial_ends_at) : null;
  const trialDaysLeft = trialEnds ? Math.ceil(msUntil(trialEnds) / DAY_MS) : null;
  const showTrial = (sub?.status ?? "trialing") === "trialing" && trialDaysLeft != null;

  return (
    <div className="space-y-6">
      <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ayarlara dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/30 blur-[90px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-400">
              <CreditCard className="h-3.5 w-3.5" /> Abonelik & iyzico
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold text-white">Paket ve ödeme</h1>
            <p className="mt-2 max-w-xl text-sm text-white/60">
              {configured
                ? "iyzico Checkout Form bağlı. Ödeme sonrası abonelik otomatik aktifleşir."
                : "Sandbox anahtarı yok — demo ödeme ile paket yükseltmeyi yerel test edebilirsiniz."}
            </p>
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/45">Mevcut paket</p>
            <p className="mt-1 font-display text-2xl font-extrabold">{planLabel(currentPlan)}</p>
            <p className="mt-1 text-xs text-mint-400">
              {statusLabel[sub?.status ?? "trialing"] ?? sub?.status ?? "Deneme"}
              {sub?.billing_cycle ? ` · ${sub.billing_cycle === "yearly" ? "Yıllık" : "Aylık"}` : ""}
            </p>
            {/* Plan tanımlarında yapısal kullanıcı limiti yok — yalnızca gerçek kullanım gösteriliyor */}
            <Link
              href="/app/ekip"
              className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-[8px] text-xs text-white/70 transition hover:text-white"
            >
              <Users2 className="h-3.5 w-3.5" /> {memberCount ?? 0} kullanıcı · ekibi yönet
            </Link>
            {showTrial ? (
              <p className={`mt-1.5 text-[11px] font-semibold ${trialDaysLeft! > 3 ? "text-white/60" : "text-amber-400"}`}>
                {trialDaysLeft! > 0
                  ? `Deneme bitişine ${trialDaysLeft} gün (${new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(trialEnds!)})`
                  : "Deneme süresi doldu — paket seçin."}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {sp.paid ? (
        <div className="rounded-[14px] border border-mint-500/30 bg-mint-500/10 px-4 py-3 text-sm font-medium text-mint-700">
          <span className="inline-flex items-center gap-2">
            <Check className="h-4 w-4" />
            Ödeme alındı{sp.demo ? " (demo)" : ""}. {sp.plan ? `${planLabel(sp.plan)} paketi aktif.` : "Paket güncellendi."}
          </span>
        </div>
      ) : null}
      {sp.error ? (
        <div className="rounded-[14px] border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-600">
          Ödeme tamamlanamadı ({sp.error}). Destek veya tekrar deneyin.
        </div>
      ) : null}

      {/* Kullanım göstergeleri — gerçek kayıt sayıları; kartlar ilgili modüle gider */}
      <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Gauge className="h-4 w-4" /> Kullanım</p>
            <h2 className="mt-1 font-display font-bold text-ink-950">Hesap kullanım göstergeleri</h2>
          </div>
          <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">{planLabel(currentPlan)} paketi</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {usage.map((u) => {
            const doluluk = u.limit ? Math.min(100, Math.round((u.value / u.limit) * 100)) : null;
            return (
              <Link
                key={u.label}
                href={u.href}
                className="focus-ring press lift group block rounded-[16px] border border-line bg-canvas/50 p-4 transition hover:border-brand-300"
              >
                <div className="flex items-start justify-between">
                  <span className={`grid h-9 w-9 place-items-center rounded-[10px] ${u.tone}`}>
                    <u.icon className="h-4.5 w-4.5" />
                  </span>
                  <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </div>
                <p className="mt-3 text-xs font-semibold text-text-muted">{u.label}</p>
                <p className="numeric mt-0.5 font-display text-xl font-extrabold text-ink-950">
                  {u.value.toLocaleString("tr-TR")}
                  {u.limit ? <span className="ml-1 text-sm font-semibold text-text-faint">/ {u.limit}</span> : null}
                </p>
                {doluluk !== null ? (
                  <>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/60">
                      <div
                        className={`h-full rounded-full ${doluluk >= 100 ? "bg-danger-500" : doluluk >= 80 ? "bg-amber-400" : "bg-mint-500"}`}
                        style={{ width: `${Math.max(4, doluluk)}%` }}
                      />
                    </div>
                    <p className={`mt-1 text-[11px] font-semibold ${doluluk >= 100 ? "text-danger-500" : "text-text-muted"}`}>
                      {doluluk >= 100 ? "Paket limiti doldu — üst pakete geçin" : `Limitin %${doluluk}'i kullanımda`}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[11px] text-text-faint">Bu pakette kayıt sınırı uygulanmıyor</p>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/app/abonelik?cycle=monthly"
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${cycle === "monthly" ? "bg-brand-600 text-white" : "border border-line bg-surface text-text-muted"}`}
        >
          Aylık
        </Link>
        <Link
          href="/app/abonelik?cycle=yearly"
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${cycle === "yearly" ? "bg-brand-600 text-white" : "border border-line bg-surface text-text-muted"}`}
        >
          Yıllık · ~%20 indirim
        </Link>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-text-muted">
          <ShieldCheck className="h-3.5 w-3.5 text-mint-600" />
          {configured ? "iyzico sandbox/prod" : "Demo mod"}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => {
          const amount = planAmountTry(plan.id, cycle);
          const current = plan.id === currentPlan;
          return (
            <article
              key={plan.id}
              className={`relative flex flex-col rounded-[20px] border p-5 shadow-[var(--shadow-xs)] ${
                current ? "border-brand-400 bg-brand-600/[0.03]" : "border-line bg-surface"
              }`}
            >
              {current ? (
                <span className="absolute right-4 top-4 rounded-full bg-mint-500/15 px-2 py-0.5 text-[11px] font-bold text-mint-600">
                  Aktif
                </span>
              ) : null}
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-brand-600">{plan.blurb}</p>
              <h2 className="mt-1 font-display text-xl font-extrabold text-ink-950">{plan.name}</h2>
              <p className="mt-3 font-display text-3xl font-extrabold text-ink-950">
                {money(amount)}
                <span className="ml-1 text-sm font-semibold text-text-muted">
                  /{cycle === "yearly" ? "yıl" : "ay"}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-text-faint">
                KDV hariç
                {cycle === "yearly" ? ` · aylık ${money(Math.round(amount / 12))}'ye gelir` : ""}
              </p>
              <ul className="mt-4 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-text-muted">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                <CheckoutButton
                  plan={plan.id}
                  cycle={cycle}
                  label={current ? (configured ? "Yenile / öde" : "Demo yenile") : configured ? "Bu pakete geç" : "Demo ile seç"}
                  variant={current ? "ghost" : "primary"}
                />
              </div>
            </article>
          );
        })}
      </div>

      {/* Fatura geçmişi — okunabilir tablo düzeni (mobilde yatay kaydırma) */}
      <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <h2 className="font-display font-bold text-ink-950">Fatura geçmişi</h2>
          </div>
          {(invoices ?? []).length > 0 ? (
            <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">
              Son {(invoices ?? []).length} fatura
            </span>
          ) : null}
        </div>
        {(invoices ?? []).length === 0 ? (
          <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
            Henüz fatura kesilmedi — ilk ödeme sonrası faturalar burada listelenir.
          </p>
        ) : (
          <TableFrame className="mt-4" minWidth={560}>
            <Table>
              <THead>
                <TR>
                  <TH>Fatura no</TH>
                  <TH>Kesim tarihi</TH>
                  <TH>Ödeme tarihi</TH>
                  <TH>Durum</TH>
                  <TH align="right">Tutar</TH>
                </TR>
              </THead>
              <TBody>
                {(invoices ?? []).map((inv) => (
                  <TR key={inv.id}>
                    <TD className="font-semibold text-ink-950">{inv.invoice_no}</TD>
                    <TD className="text-text-muted">
                      {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(inv.created_at))}
                    </TD>
                    <TD className="text-text-muted">
                      {inv.paid_at
                        ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(inv.paid_at))
                        : "—"}
                    </TD>
                    <TD>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          inv.status === "paid" ? "bg-mint-500/10 text-mint-600" : "bg-amber-400/15 text-amber-600"
                        }`}
                      >
                        {inv.status === "paid" ? "Ödendi" : inv.status === "pending" ? "Bekliyor" : inv.status}
                      </span>
                    </TD>
                    <TD align="right" className="numeric font-display font-bold text-ink-950">
                      {money(Number(inv.total_try))}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableFrame>
        )}
      </section>
    </div>
  );
}
