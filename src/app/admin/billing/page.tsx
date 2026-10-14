import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
﻿import Link from "@/components/ui/smart-link";
import { Activity, AlertTriangle, ArrowUpRight, CreditCard, FileText, RefreshCw, TrendingUp, X } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { platformCan } from "@/lib/platform-access";
import { orIlike } from "@/lib/pgrst";
import { loadPlatformMrr } from "@/lib/accounting/loaders";
import { loadMrrSnapshotDays } from "@/lib/billing/mrr-snapshot";
import { monthEndCandidateDays, mrrMonthEndSeries } from "@/lib/admin/platform-metrics";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminEmpty, AdminFilterChip, AdminSearchForm } from "@/components/admin/admin-table";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { now as clockNow } from "@/lib/clock";
import { planLabel } from "@/lib/billing/plans";
import { AreaTrendChart } from "@/components/ui/lazy-charts";
import { StackedBar } from "@/components/admin/admin-bars";
import { TrendPill, computeTrend } from "@/components/ui/premium";
import { BillingNav } from "./billing-nav";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { CaptureActions } from "./capture-actions";

const subStatus: Record<string, string> = {
  trialing: "Deneme",
  active: "Aktif",
  past_due: "Gecikmiş",
  cancelled: "İptal",
  paused: "Duraklatıldı",
};

const invStatus: Record<string, string> = {
  draft: "Taslak",
  open: "Açık",
  paid: "Ödendi",
  void: "İptal",
  uncollectible: "Tahsil edilemez",
};

type Rel = { id?: string; name?: string } | { id?: string; name?: string }[] | null;
function nameOf(v: Rel) {
  if (!v) return "—";
  return Array.isArray(v) ? (v[0]?.name ?? "—") : (v.name ?? "—");
}
function idOf(v: Rel) {
  if (!v) return null;
  return Array.isArray(v) ? (v[0]?.id ?? null) : (v.id ?? null);
}

/** Gelir eğrisi uzunluğu (ay). */
const TREND_MONTHS = 8;

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

/** `?from=&to=` — yalnızca geçerli YYYY-AA-GG kabul edilir; bozuk değer yok sayılır. */
function parseDateParam(raw: string | undefined): string | undefined {
  const v = (raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

function billingHref(p: { durum?: string; from?: string; to?: string; q?: string; sayfa?: number; fsayfa?: number }) {
  const sp = new URLSearchParams();
  if (p.durum) sp.set("durum", p.durum);
  if (p.from) sp.set("from", p.from);
  if (p.to) sp.set("to", p.to);
  if (p.q) sp.set("q", p.q);
  if (p.sayfa && p.sayfa > 1) sp.set("sayfa", String(p.sayfa));
  if (p.fsayfa && p.fsayfa > 1) sp.set("fsayfa", String(p.fsayfa));
  const s = sp.toString();
  return s ? `/admin/billing?${s}` : "/admin/billing";
}

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; from?: string; to?: string; q?: string; sayfa?: string; fsayfa?: string; odeme?: string }>;
}) {
  const staff = await requirePlatformModule("billing");
  const sp = (await searchParams) ?? {};
  // "Ödeme uyarıları" kartı: mutabakat kuyruğunu tek duruma süzer (yalnız bu iki değer kabul edilir).
  const captureFilter = sp.odeme === "manual_review" || sp.odeme === "refund_required" ? sp.odeme : null;
  const durum = sp.durum && subStatus[sp.durum] ? sp.durum : undefined;
  const from = parseDateParam(sp.from);
  const to = parseDateParam(sp.to);
  const query = (sp.q ?? "").trim();
  const subPage = parsePage(sp.sayfa);
  const invPage = parsePage(sp.fsayfa);
  const dateFiltered = Boolean(from || to);

  const admin = createAdminClient();

  /*
   * Ofis adıyla arama: `subscriptions`/`invoices` üzerinde gömülü `tenants(name)`
   * alanına doğrudan filtre uygulamak `!inner` join gerektirir ve sayım (count)
   * davranışını bozar. Bunun yerine önce eşleşen tenant id'leri çözülür; eşleşme
   * yoksa liste bilinçli olarak boş kalır (yanlışlıkla tüm kayıtları göstermez).
   */
  const matchedTenantIds = query
    ? ((await admin.from("tenants").select("id").or(orIlike(["name", "slug"], query)).limit(500)).data ?? []).map(
        (t) => t.id as string,
      )
    : null;

  let subsQuery = admin
    .from("subscriptions")
    .select("id, plan, status, billing_cycle, amount_try, trial_ends_at, current_period_end, created_at, tenant:tenants(id, name)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(...pageRange(subPage));
  if (durum) subsQuery = subsQuery.eq("status", durum);
  if (from) subsQuery = subsQuery.gte("created_at", from);
  if (to) subsQuery = subsQuery.lte("created_at", `${to}T23:59:59.999`);
  if (matchedTenantIds) subsQuery = subsQuery.in("tenant_id", matchedTenantIds.length ? matchedTenantIds : [""]);

  let invQuery = admin
    .from("invoices")
    .select("id, invoice_no, status, total_try, due_at, paid_at, created_at, reminder_count, last_reminder_at, tenant:tenants(id, name)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(...pageRange(invPage));
  if (from) invQuery = invQuery.gte("created_at", from);
  if (to) invQuery = invQuery.lte("created_at", `${to}T23:59:59.999`);
  if (matchedTenantIds) invQuery = invQuery.in("tenant_id", matchedTenantIds.length ? matchedTenantIds : [""]);

  // Halka, trend ve hero sayıları filtreden bağımsız — liste sorguları ayrı daralır
  const [
    { data: subs, count: subCount },
    { data: statRows },
    { data: invoices, count: invCount },
    { data: captureQueue, count: captureQueueCount, error: captureQueueError },
    { count: manualReviewCount },
    { count: refundRequiredCount },
    platformMrr,
    snapshotDays,
  ] = await Promise.all([
    subsQuery,
    admin.from("subscriptions").select("status, amount_try, created_at").limit(1000),
    invQuery,
    admin
      .from("billing_payment_captures")
      .select("id, tenant_id, payment_id, target_type, amount_try, status, reconciliation_attempt_count, last_error_code, captured_at", { count: "exact" })
      .in("status", captureFilter ? [captureFilter] : ["captured_pending", "retry_pending", "manual_review", "refund_required"])
      .order("captured_at", { ascending: false })
      .limit(20),
    admin.from("billing_payment_captures").select("id", { count: "exact", head: true }).eq("status", "manual_review"),
    admin.from("billing_payment_captures").select("id", { count: "exact", head: true }).eq("status", "refund_required"),
    // MRR: TEK kaynak (`loadPlatformMrr` → exactMrr; panel, muhasebe ve raporlarla aynı). Okunamazsa null → "veri yok".
    loadPlatformMrr(admin, clockNow()).catch(() => null),
    // Eğri: platform_mrr_daily ay sonu anlık görüntüleri (tablo yoksa null → tüm geçmiş aylar "veri yok").
    loadMrrSnapshotDays(admin, monthEndCandidateDays(clockNow(), TREND_MONTHS)).catch(() => null),
  ]);

  const listRows = subs ?? [];
  const listFiltered = Boolean(durum || dateFiltered || query);
  const subRows = statRows ?? [];
  const invRows = invoices ?? [];
  const reconciliationRows = captureQueue ?? [];
  const reconciliationCount = captureQueueCount ?? reconciliationRows.length;
  // MRR: TEK hesap (loadPlatformMrr → exactMrr). Okunamazsa null: ayrı/yaklaşık toplam UYDURULMAZ, "veri yok" yazılır.
  const mrr = platformMrr?.mrr ?? null;
  const trialing = subRows.filter((s) => s.status === "trialing").length;
  const pastDue = subRows.filter((s) => s.status === "past_due").length;

  // Aylık yinelenen gelir eğrisi: geçmiş aylar platform_mrr_daily'nin AY SONU anlık görüntüsü; bu ay = KPI ile aynı
  // canlı değer (kart ve eğri aynı sayıyı gösterir). Anlık görüntü öncesi aylar null → gri "veri yok", tıklanamaz.
  const nowMs = clockNow();
  const series = mrrMonthEndSeries(snapshotDays ?? [], nowMs, TREND_MONTHS);
  const trendPoints = series.map((p, i) => (i === series.length - 1 && mrr !== null ? { ...p, value: mrr } : p));
  const hasCurve = trendPoints.filter((p) => p.value !== null).length >= 2;
  const lastVal = trendPoints[trendPoints.length - 1]?.value ?? null;
  const prevVal = trendPoints[trendPoints.length - 2]?.value ?? null;
  const mrrTrend = lastVal !== null && prevVal !== null ? computeTrend(lastVal, prevVal) : null;

  const statusKeys = ["active", "trialing", "past_due", "cancelled", "paused"] as const;
  const statusCounts = statusKeys.map((k) => ({
    key: k,
    label: subStatus[k],
    count: subRows.filter((s) => s.status === k).length,
  }));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Abonelikler"
        icon={CreditCard}
        title="Gelir operasyonu"
        art="invoice"
        description="Abonelik, fatura ve tahsilat tek ekranda · iyzico bağlanınca tahsilat otomatikleşir"
      />
      <BillingNav active="genel" />
      <section aria-label="Gelir özeti" className="bx min-w-0 p-5" style={{ boxShadow: "var(--elev-3)" }}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:items-start">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {[
              { key: "active", value: mrr === null ? "Veri yok" : money(mrr), label: "Aktif aylık gelir", tone: mrr === null ? "text-text-faint" : "text-text" },
              { key: "trialing", value: String(trialing), label: "Deneme", tone: "text-amber-700" },
              { key: "past_due", value: String(pastDue), label: "Gecikmiş", tone: "text-danger-600" },
            ].map((k) => {
              const active = durum === k.key;
              return (
                <Link
                  key={k.key}
                  href={billingHref({ durum: active ? undefined : k.key, from, to, q: query })}
                  aria-current={active ? "page" : undefined}
                  className={`focus-ring group flex min-h-16 items-center justify-between gap-3 rounded-[var(--radius-card)] border px-3 py-2 transition-colors ${
                    active ? "border-[var(--accent)] bg-[var(--surface-sunken)]" : "border-hairline hover:bg-[var(--surface-sunken)]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-xs text-text-muted">{k.label}</span>
                    <span className={`num block text-2xl font-semibold tabular-nums ${k.tone}`}>{k.value}</span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint transition-colors group-hover:text-text" aria-hidden />
                </Link>
              );
            })}
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-text">
                <TrendingUp className="h-4 w-4 text-text-faint" aria-hidden /> Aylık gelir trendi · {TREND_MONTHS} ay
              </p>
              <span className="inline-flex items-center gap-2 text-sm tabular-nums">
                <span className="font-semibold text-text">{mrr === null ? "Veri yok" : money(mrr)}</span>
                {mrrTrend ? <TrendPill trend={mrrTrend} /> : null}
              </span>
            </div>
            <div style={{ height: 280 }}>
              {hasCurve ? (
                <AreaTrendChart
                  data={trendPoints.map((p) => ({ label: p.label, value: p.value, href: p.value === null ? undefined : "/admin/tenants?durum=active" }))}
                  tone="gold"
                  format="money"
                  name="Aylık yinelenen gelir"
                  ariaLabel={`Son ${TREND_MONTHS} ay aylık gelir trendi (ay sonu anlık görüntüsü)`}
                />
              ) : (
                <p className="py-8 text-center text-sm text-text-muted">
                  Gelir eğrisi günlük anlık görüntülerden çizilir; ilk ay sonu kaydı oluşunca burada görünür. Geçmiş aylar geriye dönük hesaplanmaz.
                </p>
              )}
            </div>
            <ul aria-label="Ay sonu MRR kayıtları" className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {trendPoints.map((p, i) =>
                p.value === null ? (
                  <li key={p.key} className="rounded-full border border-hairline px-2 py-0.5 text-text-faint" title="Bu ay için anlık görüntü yok">
                    {p.label} · veri yok
                  </li>
                ) : (
                  <li key={p.key}>
                    <Link href="/admin/tenants?durum=active" className="focus-ring inline-flex rounded-full border border-hairline px-2 py-0.5 tabular-nums text-text-muted hover:bg-[var(--surface-sunken)]">
                      {p.label} · {money(p.value)}
                      {i === trendPoints.length - 1 ? " (bugün)" : ""}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      </section>

      <section id="odeme-uyarilari" aria-labelledby="odeme-uyari-baslik" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <h2 id="odeme-uyari-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
          <AlertTriangle className="h-4 w-4 text-warn-600" /> Ödeme uyarıları
        </h2>
        <p className="mt-0.5 text-xs text-text-faint">
          Günlük kontrol: sağlayıcıda tahsil edilmiş ama elle karar bekleyen kayıtlar. Prosedür: docs/runbooks/IYZICO_IADE.md.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([
            { key: "manual_review", label: "Manuel inceleme", count: manualReviewCount },
            { key: "refund_required", label: "İade gerekiyor", count: refundRequiredCount },
          ] as const).map((c) => (
            <Link
              key={c.key}
              href={`/admin/billing?odeme=${c.key}#mutabakat`}
              className={`focus-ring rounded-[var(--radius-card)] border px-4 py-3 transition hover:border-brand-400 ${
                (c.count ?? 0) > 0 ? "border-danger-500/40 bg-danger-500/5" : "border-line bg-canvas"
              }`}
            >
              <span className="block text-xs font-medium text-text-muted">{c.label}</span>
              <span className="numeric font-display text-2xl font-extrabold text-ink-950">{c.count ?? "—"}</span>
            </Link>
          ))}
        </div>
      </section>

      <section id="mutabakat" className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <RefreshCw className="h-4 w-4 text-brand-600" /> Tahsilat mutabakat kuyruğu
            </h2>
            <p className="mt-0.5 text-xs text-text-faint">
              Sağlayıcıda doğrulanıp yerel işleme alınmayı bekleyen son 20 kayıt. İade gerektirenler otomatik para hareketi başlatmaz.
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
            reconciliationCount > 0
              ? "bg-danger-500/10 text-danger-600"
              : "bg-mint-500/10 text-mint-700"
          }`}>
            {reconciliationCount > 0 ? `${reconciliationCount} işlem gerekiyor` : "Kuyruk temiz"}
          </span>
        </div>

        {captureQueueError ? (
          <div className="flex items-start gap-2 px-5 py-4 text-sm text-warn-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Mutabakat kuyruğu okunamadı. Billing reconciliation migration ve servis erişimini doğrulayın.</p>
          </div>
        ) : reconciliationRows.length === 0 ? (
          <EmptyState variant="compact" bare icon={CreditCard} tone="mint" title="Mutabakat kuyruğu temiz" description="Bekleyen, inceleme veya iade kuyruğunda tahsilat yok." action={{ href: "/admin/muhasebe/defter", label: "Defteri aç" }} />
        ) : (
          <div className="divide-y divide-line">
            {reconciliationRows.map((capture) => {
              const statusLabel: Record<string, string> = {
                captured_pending: "İşleme alınacak",
                retry_pending: "Yeniden denenecek",
                manual_review: "Manuel inceleme",
                refund_required: "İade gerekli",
              };
              const urgent = capture.status === "refund_required" || capture.status === "manual_review";
              return (
                <div key={capture.id} className="grid gap-2 px-5 py-3 text-xs sm:grid-cols-[1fr_.8fr_.7fr_.8fr] sm:items-center">
                  <div>
                    <Link
                      href={`/admin/tenants/${capture.tenant_id}`}
                      className="focus-ring font-semibold text-ink-950 hover:text-brand-600"
                    >
                      {capture.target_type === "subscription" ? "Abonelik" : "Ödeme linki"}
                    </Link>
                    <p className="font-mono text-xs text-text-faint">{String(capture.payment_id).slice(0, 18)}…</p>
                  </div>
                  <p className="font-semibold text-ink-950">{money(Number(capture.amount_try))}</p>
                  <div>
                    <span className={`inline-flex rounded-full px-2 py-0.5 font-bold ${
                      urgent ? "bg-danger-500/10 text-danger-600" : "bg-warn-500/10 text-warn-600"
                    }`}>
                      {statusLabel[capture.status] ?? capture.status}
                    </span>
                    <p className="mt-1 text-xs text-text-faint">Mutabakat denemesi: {capture.reconciliation_attempt_count}</p>
                  </div>
                  <div className="sm:text-right">
                    <p className="text-text-muted">{new Date(capture.captured_at).toLocaleString("tr-TR")}</p>
                    {capture.last_error_code ? <p className="font-mono text-xs text-danger-600">{capture.last_error_code}</p> : null}
                  </div>
                  <CaptureActions captureId={capture.id} status={capture.status} isSuperAdmin={platformCan(staff, "billing", "approve")} />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Tarih aralığı — yalnızca abonelik ve fatura LİSTELERİNİ daraltır */}
      <form
        action="/admin/billing"
        className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3"
      >
        {durum ? <input type="hidden" name="durum" value={durum} /> : null}
        {query ? <input type="hidden" name="q" value={query} /> : null}
        <label className="text-xs font-semibold text-text-muted">
          Başlangıç
          <Input type="date" name="from" defaultValue={from} className="mt-1 block text-xs" />
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Bitiş
          <Input type="date" name="to" defaultValue={to} className="mt-1 block text-xs" />
        </label>
        <Button variant="navy" size="sm" type="submit">
          Uygula
        </Button>
        {dateFiltered ? (
          <Link
            href={billingHref({ durum, q: query })}
            className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600 transition hover:bg-brand-600/15"
          >
            Tarih: {from ?? "…"} → {to ?? "…"} <X className="h-3 w-3" />
          </Link>
        ) : null}
        <p className="ml-auto text-xs text-text-faint">
          Aralık, abonelik ve fatura listelerine uygulanır; özet kartlar tüm veriyi gösterir.
        </p>
      </form>

      {/* Ofis araması — abonelik ve fatura listelerinin ikisini birden daraltır */}
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
        <AdminSearchForm
          action="/admin/billing"
          defaultValue={query}
          placeholder="Ofis adı veya kısa adı ara…"
          hidden={{ durum, from, to }}
        />
        {query ? (
          <AdminFilterChip href={billingHref({ durum, from, to })}>
            Ofis araması: {query} <X className="h-3 w-3" />
          </AdminFilterChip>
        ) : null}
        <p className="ml-auto text-xs text-text-faint">
          Arama ofis adına göre çalışır; eşleşen ofislerin abonelik ve faturaları listelenir.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <section className="bx min-w-0 p-5" style={{ boxShadow: "var(--elev-1)" }}>
          <p className="bx-eyebrow flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-text-faint" aria-hidden /> Abonelik durumu
          </p>
          <h2 className="mt-0.5 font-display font-bold text-text">Durum dağılımı</h2>
          <div className="mt-4">
            {subRows.length > 0 ? (
              <StackedBar
                ariaLabel={`${subRows.length} abonelik durumlarına göre dağılım`}
                rows={statusCounts
                  .filter((s) => s.count > 0 || ["active", "trialing"].includes(s.key))
                  .map((s) => ({
                    label: s.label,
                    value: s.count,
                    hint: durum === s.key ? "filtre açık" : undefined,
                    href: billingHref({ durum: durum === s.key ? undefined : s.key, from, to, q: query }),
                  }))}
              />
            ) : (
              <EmptyState variant="compact" bare icon={CreditCard} title="Abonelik kaydı yok" description="Ofisler bir paket seçtiğinde abonelikleri burada görünür." action={{ href: "/admin/billing/planlar", label: "Paketleri aç" }} />
            )}
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <CreditCard className="h-4 w-4 text-brand-600" /> Abonelikler
            </h2>
            {durum ? (
              <Link
                href={billingHref({ from, to, q: query })}
                className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600 transition hover:bg-brand-600/15"
              >
                Durum: {subStatus[durum]} <X className="h-3 w-3" />
              </Link>
            ) : null}
          </div>
          <div className="divide-y divide-line">
            {listRows.map((s) => {
              const tenantId = idOf(s.tenant as Rel);
              return (
              <div key={s.id} className="group relative grid gap-2 px-5 py-3 transition hover:bg-brand-600/[0.02] sm:grid-cols-[1.2fr_.8fr_.7fr_.7fr] sm:items-center">
                {tenantId ? (
                  <Link href={`/admin/tenants/${tenantId}`} className="absolute inset-0" aria-label={`${nameOf(s.tenant as Rel)} kaydını aç`} />
                ) : null}
                <p className="text-sm font-semibold text-ink-950">{nameOf(s.tenant as Rel)}</p>
                <p className="text-xs text-text-muted">{planLabel(s.plan)} · {s.billing_cycle}</p>
                <p className="text-xs font-semibold text-ink-950">{money(Number(s.amount_try))}</p>
                <span className="w-fit rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-600">
                  {subStatus[s.status] ?? s.status}
                </span>
              </div>
              );
            })}
            {listRows.length === 0 ? (
              <AdminEmpty
                icon={CreditCard}
                title={listFiltered ? "Filtreyle eşleşen abonelik yok" : "Abonelik kaydı yok"}
                description={
                  listFiltered
                    ? "Durum, tarih aralığı ya da ofis aramasını gevşetip tekrar deneyin."
                    : "Ofisler paket seçtiğinde abonelik kayıtları burada listelenir."
                }
              />
            ) : null}
          </div>
          <div className="px-5 pb-4">
            <Pagination
              page={subPage}
              total={subCount ?? 0}
              hrefFor={(p) => billingHref({ durum, from, to, q: query, sayfa: p, fsayfa: invPage })}
            />
          </div>
        </section>
      </div>

      <section className="min-w-0 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <FileText className="h-4 w-4 text-brand-600" /> Faturalar
            <span className="rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-bold text-brand-600">
              {invCount ?? 0}
            </span>
          </h2>
        </div>
        {invRows.length === 0 ? (
          <AdminEmpty
            icon={FileText}
            title={listFiltered ? "Filtreyle eşleşen fatura yok" : "Henüz fatura yok"}
            description={
              listFiltered
                ? "Seçili tarih aralığı veya ofis aramasında fatura bulunamadı."
                : "Henüz ödeme oturumu başlatılmadı. Fatura taslağı ödeme başlatıldığında oluşur; yalnız doğrulanmış tahsilattan sonra ödendi durumuna geçer."
            }
          />
        ) : (
          <div className="divide-y divide-line">
            {invRows.map((inv) => {
              const tenantId = idOf(inv.tenant as Rel);
              return (
              <div key={inv.id} className="group relative grid gap-2 px-5 py-3 transition hover:bg-brand-600/[0.02] sm:grid-cols-[1fr_.7fr_.7fr_.7fr] sm:items-center">
                <Link href={`/admin/billing/faturalar/${inv.id}`} className="absolute inset-0" aria-label={`${inv.invoice_no} fatura detayını aç`} />
                <div>
                  <p className="text-sm font-semibold text-ink-950">{inv.invoice_no}</p>
                  {tenantId ? (
                    <Link href={`/admin/tenants/${tenantId}`} className="focus-ring relative z-10 text-xs text-text-muted hover:text-brand-600">{nameOf(inv.tenant as Rel)}</Link>
                  ) : (
                    <p className="text-xs text-text-muted">{nameOf(inv.tenant as Rel)}</p>
                  )}
                </div>
                <p className="text-xs font-semibold">{money(Number(inv.total_try))}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-fit rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600">
                    {invStatus[inv.status] ?? inv.status}
                  </span>
                  {Number(inv.reminder_count) > 0 ? (
                    // Dunning cron'unun bıraktığı iz: kaç hatırlatma gitti?
                    <span
                      className="w-fit rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-600"
                      title={
                        inv.last_reminder_at
                          ? `Son hatırlatma: ${new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(inv.last_reminder_at))}`
                          : undefined
                      }
                    >
                      {inv.reminder_count} hatırlatma
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-text-faint">
                  {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(inv.created_at))}
                </p>
              </div>
              );
            })}
          </div>
        )}
        <div className="px-5 py-4">
          <Pagination
            page={invPage}
            total={invCount ?? 0}
            hrefFor={(p) => billingHref({ durum, from, to, q: query, sayfa: subPage, fsayfa: p })}
          />
        </div>
      </section>

      {/* Deneme ve yenileme ayarları: ayar defterinden, tek düzenleme yeri burası (merkez buraya bağlanır). */}
      <RegistrySettings
        title="Ayarlar"
        description="Deneme süresi, deneme sonrası tolerans, otomatik yenileme, oransal paket yükseltme, abonelik duraklatma, dönemi biten aboneliğin gecikmişe geçmesi ve TL kredinin fatura payı. Fiyatlar Plan editöründedir."
        keys={["billing.default_trial_days", "billing.trial_grace_days", "billing.auto_renew_enabled", "billing.plan_change_proration_enabled", "billing.pause_enabled", "billing.pause_max_days", "billing.expire_to_past_due", "try_credit.max_invoice_share"]}
        canEdit={staff.role === "super_admin"}
      />
    </div>
  );
}
