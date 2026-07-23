import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CreditCard,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PLANS, planAmountTry, planLabel, type BillingCycle } from "@/lib/billing/plans";
import { isIyzicoConfigured } from "@/lib/billing/iyzico";
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

  const [{ data: tenant }, { data: sub }, { data: invoices }] = await Promise.all([
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
  ]);

  const currentPlan = sub?.plan ?? tenant?.plan ?? "office";

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
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">Mevcut paket</p>
            <p className="mt-1 font-display text-2xl font-extrabold">{planLabel(currentPlan)}</p>
            <p className="mt-1 text-xs text-mint-400">
              {statusLabel[sub?.status ?? "trialing"] ?? sub?.status ?? "Deneme"}
              {sub?.billing_cycle ? ` · ${sub.billing_cycle === "yearly" ? "Yıllık" : "Aylık"}` : ""}
            </p>
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
                <span className="absolute right-4 top-4 rounded-full bg-mint-500/15 px-2 py-0.5 text-[10px] font-bold text-mint-600">
                  Aktif
                </span>
              ) : null}
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-600">{plan.blurb}</p>
              <h2 className="mt-1 font-display text-xl font-extrabold text-ink-950">{plan.name}</h2>
              <p className="mt-3 font-display text-3xl font-extrabold text-ink-950">
                {money(amount)}
                <span className="ml-1 text-sm font-semibold text-text-muted">
                  /{cycle === "yearly" ? "yıl" : "ay"}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-text-faint">KDV hariç</p>
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

      <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <h2 className="font-display font-bold text-ink-950">Son faturalar</h2>
        </div>
        {(invoices ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">Henüz fatura yok.</p>
        ) : (
          <div className="mt-4 divide-y divide-line">
            {(invoices ?? []).map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-semibold text-ink-950">{inv.invoice_no}</p>
                  <p className="text-xs text-text-muted">
                    {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(inv.created_at))}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display font-bold text-ink-950">{money(Number(inv.total_try))}</p>
                  <p className={`text-[11px] font-semibold ${inv.status === "paid" ? "text-mint-600" : "text-amber-600"}`}>
                    {inv.status === "paid" ? "Ödendi" : inv.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
