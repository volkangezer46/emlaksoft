import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Check,
  Contact2,
  Gauge,
  GitBranch,
  Sparkles,
  ShieldCheck,
  Users2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { requireModulePage } from "@/lib/require-module-page";
import { DAY_MS, msSince, msUntil, now } from "@/lib/clock";
import { BILLING_VAT_RATE, planAmountOf, yearlyOfferLabel, type BillingCycle } from "@/lib/billing/plans";
import { getPlanDefinition, getPublicPlanDefinitions, getSeatSettings } from "@/lib/billing/plan-definitions";
import { getSeatSupport, loadSeatState, type SeatUsageSummary } from "@/lib/billing/seat-purchase";
import { seatUtilization } from "@/lib/billing/seat-pricing";
import { warnRatioOf } from "@/lib/billing/seat-settings";
import { SeatLimitBanner } from "@/components/app/seat-limit-banner";
import { SeatPanel } from "./seat-panel";
import { getPlanSupport } from "@/lib/billing/plan-support";
import { isIyzicoConfigured } from "@/lib/billing/iyzico";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CheckoutButton } from "./checkout-button";
import { CancelPanel } from "./cancel-panel";
import { CardsPanel } from "./cards-panel";
import { getPlatformSetting } from "@/lib/platform-settings";
import { normalizeBuyerIdentityNumber } from "@/lib/billing/buyer";
import {
  AUTO_RENEW_FLAG_KEY,
  maskedCardLabel,
  parseAutoRenewFlag,
  type PaymentCardRow,
} from "@/lib/billing/cards";
import { KontorSection } from "./kontor-section";
import { ReferralNudge } from "@/components/app/referral-nudge";
import { CuzdanSection } from "./cuzdan-section";
import { readTryOverview } from "@/lib/try-credits/reader";
import { getTryMaxShare } from "@/lib/try-credits/settings";
import { TRY_DEFAULT_MAX_SHARE } from "@/lib/try-credits/constants";
import type { WalletCheckoutInfo } from "@/components/app/wallet-credit-toggle";
import { monthlyUnitsWithSeats } from "@/lib/ef-credits/plan-credits";
import { loadLatestPackInvoice } from "@/lib/ef-credits/credit-reader";
import { DetailTabs, resolveTab, type DetailTabDef } from "@/components/app/detail-tabs";

import { PageHeader } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
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
  searchParams: Promise<{ paid?: string; demo?: string; plan?: string; error?: string; cycle?: string; sekme?: string; kalem?: string; kullanici?: string; sayfa?: string; yon?: string; onerilen?: string }>;
}) {
  const auth = await requireModulePage("billing");
  const sp = await searchParams;
  const active = resolveTab(sp, ["plan", "kontor", "cuzdan", "faturalar", "iptal"], "plan");
  const cycle = (sp.cycle === "yearly" ? "yearly" : "monthly") as BillingCycle;
  const supabase = await createClient();
  const configured = isIyzicoConfigured();

  const user = await getRequestUser();
  const tenantId = user?.app_metadata?.tenant_id as string | undefined;

  const [
    { data: tenant },
    { data: sub },
    { data: invoices },
    { count: memberCount },
    { count: propertyCount },
    { count: customerCount },
    { count: branchCount },
  ] = await Promise.all([
    tenantId
      ? supabase.from("tenants").select("id, name, plan, status, tax_number, address_line, city, team_size").eq("id", tenantId).maybeSingle()
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
          .select("id, invoice_no, status, total_try, paid_at, created_at, period_start, period_end")
          .eq("tenant_id", tenantId)
          .in("status", ["open", "paid", "void", "uncollectible"])
          .order("created_at", { ascending: false })
          .limit(active === "faturalar" ? 50 : 8)
      : Promise.resolve({ data: [] }),
    tenantId
      ? supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
      : Promise.resolve({ count: null }),
    // Kullanım göstergeleri DB entitlement tetikleyicisiyle aynı kapsamı sayar.
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .in("status", ["draft", "live", "reserved"]),
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("branches").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);

  const currentPlan = sub?.plan ?? tenant?.plan ?? "office";
  // Kontör paketi ödemesi sonrası dönüş mesajı: son kontör faturası yeniyse plan mesajı yerine kontör mesajı.
  const packInvoice = tenantId && (sp.paid || active === "kontor") ? await loadLatestPackInvoice(supabase, tenantId) : null;
  const packInvoiceRecent = Boolean(packInvoice && msSince(packInvoice.paidAt ?? packInvoice.createdAt) < 15 * 60_000);

  // Dönem sonu iptal (K5): kolonlar henüz yoksa sorgu hata verir ve iptal sekmesi gizlenir.
  const { data: cancelRow, error: cancelColError } = tenantId
    ? await supabase
        .from("subscriptions")
        .select("cancel_at_period_end")
        .eq("tenant_id", tenantId)
        .maybeSingle()
    : { data: null, error: { message: "tenant yok" } };
  const cancelSupported = !cancelColError;
  const pendingCancel = Boolean(cancelRow?.cancel_at_period_end);
  const periodEndLabel = sub?.current_period_end
    ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(new Date(sub.current_period_end))
    : null;
  const canCancel = auth.role === "owner" || auth.role === "gm";
  const tabs: DetailTabDef[] = [
    { id: "plan", label: "Plan ve kullanım" },
    { id: "kontor", label: "Kontör" },
    // Hesap kredisi yalnız ofis sahibi ve genel müdüre görünür (sekme gizlenir; doğrudan bağlantıda bölüm mesaj gösterir).
    { id: "cuzdan", label: "Hesap kredisi", hidden: !(auth.role === "owner" || auth.role === "gm") },
    { id: "faturalar", label: "Faturalar" },
    { id: "iptal", label: "İptal", hidden: !cancelSupported },
  ];

  const [publicPlans, currentPlanDef, planSupport, seatSupport, seatSettings] = await Promise.all([
    getPublicPlanDefinitions(),
    getPlanDefinition(currentPlan),
    getPlanSupport(),
    getSeatSupport(),
    getSeatSettings(),
  ]);
  // Koltuk: şema hazırsa satın alınmış ek kullanıcılar (RLS'li okuma); değilse plan limiti.
  const seatState = tenantId ? await loadSeatState(supabase, tenantId, seatSupport) : null;
  const extraSeats = seatState?.extraSeats ?? 0;
  const seatLimit = currentPlanDef.limits.seats + extraSeats;
  const seatUtil = seatUtilization(memberCount ?? 0, currentPlanDef.limits.seats, extraSeats, warnRatioOf(seatSettings));
  const seatSummary: SeatUsageSummary = {
    used: memberCount ?? 0,
    included: currentPlanDef.limits.seats,
    extra: extraSeats,
    limit: seatLimit,
    ratio: seatUtil.ratio,
    level: seatUtil.level,
    warnPercent: seatSettings.warnPercent,
  };
  const isSeatOwner = auth.role === "owner" || auth.role === "gm";

  // Kayıtlı kartlar: RLS'li okuma, yalnız güvenli sütunlar (sağlayıcı anahtarları istemciye çıkmaz). Tablo yoksa
  // (migration uygulanmadı) panel ve "kartımı sakla" kutusu hiç görünmez.
  const [cardsRes, cardProfileRes, autoRenewRaw] = tenantId
    ? await Promise.all([
        supabase
          .from("payment_cards")
          .select("id, brand, card_family, bin_prefix, last_four, is_default, consent_at, created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabase
          .from("tenant_payment_profiles")
          .select("auto_renew_enabled, auto_renew_card_id")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        getPlatformSetting(AUTO_RENEW_FLAG_KEY),
      ])
    : [{ data: null, error: { message: "tenant yok" } }, { data: null }, null];
  const cardsSupported = !cardsRes.error;
  const savedCards = (cardsRes.data ?? []) as PaymentCardRow[];
  const defaultSavedCard = savedCards.find((c) => c.is_default) ?? savedCards[0] ?? null;
  const autoRenewAvailable = parseAutoRenewFlag(autoRenewRaw as string | null);
  // TL hesap kredisi: bakiye oturumlu RLS'li RPC ile okunur; SQL yoksa null (onay kutusu hiç görünmez).
  const walletOverview = tenantId ? await readTryOverview(supabase) : null;
  const walletMaxShare = walletOverview ? await getTryMaxShare() : TRY_DEFAULT_MAX_SHARE;
  const walletCheckout: WalletCheckoutInfo | null =
    configured && isSeatOwner && walletOverview && walletOverview.available > 0
      ? { availableTry: walletOverview.available, maxShare: walletMaxShare }
      : null;
  const seatPlans = publicPlans.some((p) => p.id === currentPlanDef.id) ? publicPlans : [currentPlanDef, ...publicPlans];
  const planLabel = (id: string) =>
    publicPlans.find((p) => p.id === id)?.name ?? (id === currentPlanDef.id ? currentPlanDef.name : id);
  // Gizli plandaki mevcut abone kendi paketini de görür; yeni satışa açık olanlar listelenir.
  const listedPlans = publicPlans.some((p) => p.id === currentPlanDef.id)
    ? publicPlans
    : [currentPlanDef, ...publicPlans];
  const usage = [
    { label: "Kullanıcı", value: memberCount ?? 0, limit: seatLimit, icon: Users2, href: "/app/ekip", tone: "text-accent-text bg-surface-accent-soft" },
    { label: "Aktif portföy", value: propertyCount ?? 0, limit: currentPlanDef.limits.activeProperties, icon: Building2, href: "/app/portfoyler", tone: "text-success-strong bg-mint-500/10" },
    { label: "Müşteri kaydı", value: customerCount ?? 0, limit: currentPlanDef.limits.customers, icon: Contact2, href: "/app/musteriler", tone: "text-amber-600 bg-amber-400/10" },
    { label: "Aktif şube", value: branchCount ?? 0, limit: currentPlanDef.limits.branches, icon: GitBranch, href: "/app/ekip", tone: "text-cyan-600 bg-cyan-400/10" },
  ];

  // Deneme geri sayımı — yalnızca trialing durumunda anlamlı
  const trialEnds = sub?.trial_ends_at ? new Date(sub.trial_ends_at) : null;
  const trialDaysLeft = trialEnds ? Math.ceil(msUntil(trialEnds) / DAY_MS) : null;
  const showTrial = (sub?.status ?? "trialing") === "trialing" && trialDaysLeft != null;

  // Fatura bilgisi eksikliği: validateCheckoutBuyer ile AYNI kurallar (geçerli TC/vergi no, adres >= 10, şehir >= 2).
  const billingMissing: string[] = [];
  if (tenant) {
    if (!normalizeBuyerIdentityNumber(tenant.tax_number)) billingMissing.push("vergi no");
    if (String(tenant.address_line ?? "").trim().length < 10) billingMissing.push("adres");
    if (String(tenant.city ?? "").trim().length < 2) billingMissing.push("şehir");
  }
  // Kayıtta seçilen ekip büyüklüğü (tenants.team_size) ile mevcut koltuk karşılaştırması. Üst sınır tahmindir: "en fazla".
  const TEAM_SIZE_MAX: Record<string, number> = { "1": 1, "2-10": 10, "10-50": 50 };
  const teamSizeLabel = tenant?.team_size === "50+" ? "50+" : tenant?.team_size ?? null;
  const teamSizeNeed = tenant?.team_size ? TEAM_SIZE_MAX[tenant.team_size] ?? null : null;
  const seatShortfall = teamSizeNeed != null ? Math.max(0, teamSizeNeed - seatLimit) : tenant?.team_size === "50+" ? Math.max(0, 51 - seatLimit) : 0;
  const paidInvoiceCount = (invoices ?? []).filter((i) => i.status === "paid").length;
  const firstPaymentJustNow = Boolean(sp.paid && sp.plan && !packInvoiceRecent && paidInvoiceCount === 1);

  return (
    <div className="space-y-6">
      <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-accent-text">
        <ArrowLeft className="h-4 w-4" /> Ayarlara dön
      </Link>

      <PageHeader title="Paket ve ödeme" eyebrow="Abonelik & iyzico" description={<>{configured
                ? "Ödeme altyapısı (iyzico) bağlı. Ödeme sonrası aboneliğiniz otomatik başlar."
                : "Ödeme altyapısı henüz bağlı değil; paket yükseltmeyi deneme amaçlı demo ödemeyle görebilirsiniz."} <HelpTip topic="paket-kota" /></>} actions={
<div className="theme-dark flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-ink)] p-2"><div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-white/45">Mevcut paket</p>
            <p className="mt-1 font-display text-2xl font-extrabold">{planLabel(currentPlan)}</p>
            <p className="mt-1 text-xs text-mint-400">
              {statusLabel[sub?.status ?? "trialing"] ?? sub?.status ?? "Deneme"}
              {sub?.billing_cycle ? ` · ${sub.billing_cycle === "yearly" ? "Yıllık" : "Aylık"}` : ""}
            </p>
            {/* Plan tanımlarında yapısal kullanıcı limiti yok — yalnızca gerçek kullanım gösteriliyor */}
            <Link
              href="/app/ekip"
              className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] text-xs text-white/70 transition hover:text-white"
            >
              <Users2 className="h-3.5 w-3.5" /> {memberCount ?? 0} kullanıcı · ekibi yönet
            </Link>
            {showTrial ? (
              <p className={`mt-1.5 text-xs font-semibold ${trialDaysLeft! > 3 ? "text-white/60" : "text-amber-400"}`}>
                {trialDaysLeft! > 0
                  ? `Deneme bitişine ${trialDaysLeft} gün (${new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(trialEnds!)})`
                  : "Deneme süresi doldu — paket seçin."}
              </p>
            ) : null}
          </div></div>
} />

      {sp.paid ? (
        <div className="rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/10 px-4 py-3 text-sm font-medium text-success-strong">
          <span className="inline-flex items-center gap-2">
            <Check className="h-4 w-4" />
            Ödeme alındı{sp.demo ? " (demo)" : ""}. {packInvoiceRecent && packInvoice?.status === "paid" ? "Kontör paketiniz bakiyenize eklenir (Kontör sekmesinden görebilirsiniz)." : sp.plan ? `${planLabel(sp.plan)} paketi aktif.` : "Paket güncellendi."}
          </span>
        </div>
      ) : null}
      <ReferralNudge moment="first_payment" show={firstPaymentJustNow} />
      <ReferralNudge moment="credit_purchase" show={Boolean(sp.paid && packInvoiceRecent && packInvoice?.status === "paid")} />
      {sp.error ? (
        <div className="rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-600">
          Ödeme tamamlanamadı ({sp.error}). Destek veya tekrar deneyin.
        </div>
      ) : null}

      {billingMissing.length > 0 && isSeatOwner ? (
        <Link
          href="/app/ayarlar#marka-kimlik"
          className="block rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm font-medium text-warning-strong"
        >
          Fatura bilgileriniz eksik: {billingMissing.join(", ")}. Ödeme ve fatura için Ayarlar &gt; Şirket bölümünden tamamlayın.
        </Link>
      ) : null}

      {seatShortfall > 0 && isSeatOwner ? (
        <Link
          href={seatSupport.displayEnabled ? "#koltuk" : "/app/ekip"}
          className="block rounded-[var(--radius-card)] border border-brand-300/50 bg-brand-600/5 px-4 py-3 text-sm font-medium text-text"
        >
          Kayıtta {teamSizeLabel} kullanıcı seçtiniz; planınızda {seatLimit} koltuk var, en fazla {seatShortfall} ek koltuk gerekebilir. Koltukları görün.
        </Link>
      ) : null}

      {pendingCancel && cancelSupported ? (
        <Link
          href="/app/abonelik?sekme=iptal"
          className="block rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm font-medium text-warning-strong"
        >
          İptal talebiniz var: aboneliğiniz{periodEndLabel ? ` ${periodEndLabel} tarihinde` : " dönem sonunda"} sona erecek. Ayrıntı ve geri alma için tıklayın.
        </Link>
      ) : null}

      {/* Limit uyarıları: %80 ve üzeri kullanım, ilgili modüle götürür */}
      {/* Koltuk uyarısı: admin eşiği (varsayılan %80) ve %100; koltuk satın alma paneline götürür */}
      <SeatLimitBanner summary={seatSummary} href={seatSupport.displayEnabled ? "#koltuk" : "/app/ekip"} />
      {usage
        .filter((u) => u.label !== "Kullanıcı" && u.limit && u.value / u.limit >= 0.8)
        .map((u) => (
          <Link
            key={u.label}
            href={u.href}
            className={`block rounded-[var(--radius-card)] border px-4 py-3 text-sm font-medium ${
              u.value >= (u.limit ?? 0)
                ? "border-danger-500/30 bg-danger-500/10 text-danger-600"
                : "border-amber-400/40 bg-amber-400/10 text-warning-strong"
            }`}
          >
            {u.label}: {u.value}/{u.limit}{" "}
            {u.value >= (u.limit ?? 0) ? "— paket limiti doldu, üst pakete geçin." : "— limite yaklaşıyorsunuz."}
          </Link>
        ))}

      <DetailTabs basePath="/app/abonelik" tabs={tabs} active={active} label="Abonelik sekmeleri" />

      {active === "iptal" && cancelSupported ? (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="font-display font-bold text-text">Aboneliği iptal et</h2>
          <div className="mt-3">
            <CancelPanel canCancel={canCancel} pendingCancel={pendingCancel} endsAtLabel={periodEndLabel} />
          </div>
        </section>
      ) : null}

      {active === "kontor" && tenantId ? (
        <KontorSection
          tenantId={tenantId}
          canBuy={isSeatOwner}
          iyzicoConfigured={configured}
          kalem={sp.kalem}
          kullanici={sp.kullanici}
          sayfa={sp.sayfa}
          onerilen={sp.onerilen === "1"}
          latestInvoice={packInvoice}
          invoiceIsRecent={packInvoiceRecent}
          allowance={{
            planName: currentPlanDef.name,
            units: monthlyUnitsWithSeats(currentPlanDef.efCreditsMonthly, currentPlanDef.efCreditsPerExtraSeat, extraSeats),
            perExtraSeat: currentPlanDef.efCreditsPerExtraSeat ?? 0,
            extraSeats,
          }}
          wallet={walletCheckout}
        />
      ) : null}

      {active === "cuzdan" && tenantId ? (
        <CuzdanSection supabase={supabase} maxShare={walletMaxShare} yon={sp.yon} canSpend={isSeatOwner} />
      ) : null}

      {active === "plan" ? (
      <>
      {/* Kullanım göstergeleri — gerçek kayıt sayıları; kartlar ilgili modüle gider */}
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-accent-text"><Gauge className="h-4 w-4" /> Kullanım</p>
            <h2 className="mt-1 font-display font-bold text-text">Hesap kullanım göstergeleri</h2>
          </div>
          <span className="rounded-full bg-surface-accent-soft px-2.5 py-1 text-xs font-bold text-accent-text">{planLabel(currentPlan)} paketi</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {usage.map((u) => {
            const doluluk = u.limit ? Math.min(100, Math.round((u.value / u.limit) * 100)) : null;
            return (
              <Link
                key={u.label}
                href={u.href}
                className="focus-ring press lift group block rounded-[var(--radius-card)] border border-line bg-canvas/50 p-4 transition hover:border-brand-300"
              >
                <div className="flex items-start justify-between">
                  <span className={`grid h-9 w-9 place-items-center rounded-[var(--radius-control)] ${u.tone}`}>
                    <u.icon className="h-4.5 w-4.5" />
                  </span>
                  <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-accent-text group-hover:opacity-100" />
                </div>
                <p className="mt-3 text-xs font-semibold text-text-muted">{u.label}</p>
                <p className="numeric mt-0.5 font-display text-xl font-extrabold text-text">
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
                    <p className={`mt-1 text-xs font-semibold ${doluluk >= 100 ? "text-danger-strong" : "text-text-muted"}`}>
                      {doluluk >= 100 ? "Paket limiti doldu — üst pakete geçin" : `Limitin %${doluluk}'i kullanımda`}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-text-faint">Bu pakette kayıt sınırı uygulanmıyor</p>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      {seatSupport.displayEnabled && seatState ? (
        <SeatPanel
          plans={seatPlans}
          planId={seatState.planId}
          cycle={seatState.cycle}
          usedSeats={memberCount ?? 0}
          includedSeats={currentPlanDef.limits.seats}
          extraSeats={extraSeats}
          lockedBaseMonthlyTry={seatState.lockedBaseMonthlyTry}
          lockedTiers={seatState.lockedTiers}
          periodStartMs={seatState.periodStartMs}
          periodEndMs={seatState.periodEndMs}
          nowMs={now()}
          canBuy={isSeatOwner}
          purchaseReady={seatSupport.purchaseReady && configured}
          subscriptionActive={seatState.status === "active"}
          warnPercent={seatSettings.warnPercent}
          wallet={walletCheckout}
        />
      ) : (
        <section id="koltuk" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-accent-text"><Users2 className="h-4 w-4" /> Kullanıcı ekle / çıkar</p>
          <p className="mt-2 text-sm text-text-muted">
            Etkin değil: yönetici hazırlığı tamamlanıyor. Şu an paketinize dahil {currentPlanDef.limits.seats} kullanıcıdan {memberCount ?? 0} tanesini kullanıyorsunuz;
            daha fazlası için aşağıdan üst pakete geçebilirsiniz.
          </p>
        </section>
      )}

      {cardsSupported && configured ? (
        <CardsPanel
          cards={savedCards}
          canManage={isSeatOwner}
          autoRenewAvailable={autoRenewAvailable}
          autoRenewEnabled={Boolean(cardProfileRes.data?.auto_renew_enabled)}
          autoRenewCardId={(cardProfileRes.data?.auto_renew_card_id as string | null) ?? null}
        />
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
          Yıllık · {yearlyOfferLabel(publicPlans[0] ?? {})}
        </Link>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-text-muted">
          <ShieldCheck className="h-3.5 w-3.5 text-success-strong" />
          {configured ? "Güvenli ödeme" : "Demo mod"}
        </span>
      </div>

      <div id="paketler" className="grid scroll-mt-24 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {listedPlans.map((plan) => {
          const amount = planAmountOf(plan, cycle);
          const sellable = !plan.hidden;
          const current = plan.id === currentPlan;
          return (
            <article
              key={plan.id}
              className={`relative flex flex-col rounded-[var(--radius-panel)] border p-5 shadow-[var(--shadow-xs)] ${
                current ? "border-brand-400 bg-brand-600/[0.03]" : "border-line bg-surface"
              }`}
            >
              {current ? (
                <span className="absolute right-4 top-4 rounded-full bg-mint-500/15 px-2 py-0.5 text-xs font-bold text-success-strong">
                  Aktif
                </span>
              ) : null}
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-accent-text">{plan.blurb}</p>
              <h2 className="mt-1 font-display text-xl font-extrabold text-text">{plan.name}</h2>
              <p className="mt-3 font-display text-3xl font-extrabold text-text">
                {money(amount)}
                <span className="ml-1 text-sm font-semibold text-text-muted">
                  /{cycle === "yearly" ? "yıl" : "ay"}
                </span>
              </p>
              <p className="mt-1 text-xs text-text-faint">
                KDV hariç
                {cycle === "yearly"
                  ? ` · ${plan.yearlyPaidMonths ?? 10} ay ödenir, aylık ${money(Math.round(amount / 12))}'ye gelir`
                  : ""}
              </p>
              <ul className="mt-4 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-text-muted">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-strong" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {sellable ? (
                  <CheckoutButton
                    plan={plan.id}
                    cycle={cycle}
                    label={current ? (configured ? "Yenile / öde" : "Demo yenile") : configured ? "Bu pakete geç" : "Demo ile seç"}
                    variant={current ? "ghost" : "primary"}
                    couponsEnabled={planSupport.coupons}
                    canSaveCard={cardsSupported && configured && isSeatOwner}
                    savedCardLabel={
                      cardsSupported && configured && isSeatOwner && defaultSavedCard ? maskedCardLabel(defaultSavedCard) : null
                    }
                    wallet={current || sellable ? walletCheckout : null}
                    totalTry={Math.round(amount * (1 + BILLING_VAT_RATE) * 100) / 100}
                  />
                ) : (
                  <p className="rounded-[var(--radius-control)] border border-dashed border-line-strong px-3 py-2 text-center text-xs text-text-muted">
                    Bu paket yeni satışa kapalı; mevcut aboneliğiniz değişmez.
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      </>
      ) : null}

      {/* Fatura geçmişi — okunabilir tablo düzeni (mobilde yatay kaydırma) */}
      {active === "faturalar" ? (
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <h2 className="font-display font-bold text-text">Fatura geçmişi</h2>
          </div>
          {(invoices ?? []).length > 0 ? (
            <span className="rounded-full bg-surface-accent-soft px-2.5 py-1 text-xs font-bold text-accent-text">
              Son {(invoices ?? []).length} fatura
            </span>
          ) : null}
        </div>
        {(invoices ?? []).length === 0 ? (
          <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
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
                  <TH align="right">Detay</TH>
                </TR>
              </THead>
              <TBody>
                {(invoices ?? []).map((inv) => (
                  <TR key={inv.id}>
                    <TD className="font-semibold text-text"><Link href={`/app/abonelik/fatura/${inv.id}`} className="hover:text-accent-text hover:underline">{inv.invoice_no}</Link></TD>
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
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                          inv.status === "paid" ? "bg-mint-500/10 text-success-strong" : "bg-amber-400/15 text-amber-600"
                        }`}
                      >
                        {{ paid: "Ödendi", open: "Ödeme bekliyor", void: "İptal", uncollectible: "Tahsil edilemedi" }[inv.status as string] ?? inv.status}
                      </span>
                    </TD>
                    <TD align="right" className="numeric font-display font-bold text-text">
                      {money(Number(inv.total_try))}
                    </TD>
                    <TD align="right">
                      <Link href={`/app/abonelik/fatura/${inv.id}`} className="text-xs font-semibold text-accent-text hover:underline">
                        Aç / yazdır
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableFrame>
        )}
      </section>
      ) : null}
    </div>
  );
}
