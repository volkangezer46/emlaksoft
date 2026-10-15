import { Suspense } from "react";
import Link from "@/components/ui/smart-link";
import { ArrowDownCircle, ArrowUpCircle, Banknote, CreditCard, FileBarChart, FileSpreadsheet, HandCoins, Inbox, Landmark, Lock, ScanLine, Wallet } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/list-kit";
import { formatDateTr } from "@/lib/format";
import { now, trDayKey } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { fetchLatestRates, type FxRates } from "@/lib/fx";
import type { FinanceTabProps } from "@/lib/finance/ledger/types";
import { loadMatchContext, loadPendingLines, loadReconStatus, type ReconStatus } from "@/lib/finance/statement/load";
import { guessCategory, shiftIso, suggestAll } from "@/lib/finance/statement/match";
import { cashCategoryLabel } from "@/lib/finance/cash/categories";
import { ACCOUNT_KIND_LABEL, isUuid } from "@/lib/finance/cash/input";
import { isMissingCashSchema, loadAccountsWithBalances, loadRecentEntriesByAccount, type AccountWithBalance, type CashEntry } from "@/lib/finance/cash/load";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { AccountFormButton, ArchiveAccountButton, TransferButton } from "../accounts-panel";
import { AccountSparkline, dailyBalanceSeries, type DayMove } from "../kasa-banka/account-sparkline";
import { ReconcileQueue, type QueueItem } from "../kasa-banka/reconcile-queue";
import { CommissionCashQueue } from "../kasa-banka/commission-cash-queue";
import { loadCommissionsMissingCash } from "@/lib/finance/cash/collection-link";
import { effectiveHasPermission } from "@/lib/permissions-merge";
import { loadMovesForAccounts } from "../kasa-banka/moves";
import { loadFinanceRules, StatementReview } from "../statement-review";
import { StatementUploadButton } from "../statement-upload";
import { FINANCE_BASE } from "./finance-shell";

const KIND_ICON = { cash: Banknote, bank: Landmark, card: CreditCard } as const;

const hareketlerHref = (accountId: string) => `${FINANCE_BASE}?sekme=hareketler&hesap=${accountId}`;
const ekstreHref = (accountId: string) => `${FINANCE_BASE}?sekme=kasa-banka&ekstre=${accountId}`;

/** Kasam (ve eski çağıranlar) için: istemci ve hesaplar dışarıdan gelir. */
export type KasaBankaProps = {
  /** Hesap -> ekstre onay ekranı adresi (Kasam kendi sayfasına yönlendirir). */
  statementHref?: (accountId: string) => string;
  /** ?ekstre= ile açılan hesap: üstte ekstre taslağı gösterilir. */
  reviewAccountId?: string | null;
  /** Maaş kategorisi önerilebilir/seçilebilir mi (yalnız ofis sahibi / GM). */
  canSalary?: boolean;
  /** Hesap -> hareketler adresi (Kasam kendi sayfasına yönlendirir). */
  entriesHref?: (accountId: string) => string;
  supabase: SupabaseClient;
  accounts: readonly AccountWithBalance[];
  today: string;
  /** `expenses` oluşturma/düzenleme yetkisi: ofis hesabı açabilir ve düzenleyebilir. */
  canOffice: boolean;
};

/**
 * Kasa ve banka sekmesi: hesap kartları (bakiye, son 30 gün çizgisi, TL karşılığı, son hareketler), ekstre yükleme ve
 * "İncelenecek" mutabakat kuyruğu. Bakiye ve her sayı filtreli Hareketler'e gider (sıfır çıkmaz metrik). Kişisel hesaplar
 * ayrı bölümde ve yalnız sahibine görünür (RLS). Kasam (`KasaBankaProps`) eski görünümü aynen kullanır.
 */
export async function KasaBankaTab(props: FinanceTabProps | KasaBankaProps) {
  if ("supabase" in props) return <AccountsBoard {...props} />;
  const supabase = await createClient();
  const cash = await loadAccountsWithBalances(supabase);
  const ekstre = props.params.ekstre;
  return (
    <AccountsBoard
      supabase={supabase}
      accounts={cash.accounts}
      today={trDayKey(now())}
      canOffice={props.canCreate}
      canSalary={props.canSalary}
      reviewAccountId={isUuid(ekstre) ? ekstre : null}
      finance
      canRule={props.canEdit}
      commissionCash={effectiveHasPermission(props.perms, "commissions", "edit") ? props.tenantId : null}
    />
  );
}

async function AccountsBoard({
  supabase,
  accounts,
  today,
  canOffice,
  entriesHref = hareketlerHref,
  statementHref = ekstreHref,
  reviewAccountId = null,
  canSalary = false,
  finance = false,
  canRule = false,
  commissionCash = null,
}: KasaBankaProps & { finance?: boolean; canRule?: boolean; /** "Kasaya işle" kuyruğu (komisyon düzenleme yetkisi): kiracı kimliği. */ commissionCash?: string | null }) {
  const active = accounts.filter((a) => !a.archived_at);
  const archived = accounts.filter((a) => a.archived_at);
  const office = active.filter((a) => a.owner_scope === "office");
  const personal = active.filter((a) => a.owner_scope === "user");
  const [recent, recon, moves, rates] = await Promise.all([
    loadRecentEntriesByAccount(supabase, active.map((a) => a.id), 3),
    loadReconStatus(supabase),
    finance ? loadMoves(supabase, active.map((a) => a.id), shiftIso(today, -30)) : Promise.resolve(new Map<string, DayMove[] | null>()),
    finance && active.some((a) => a.currency !== "TRY") ? fetchLatestRates(supabase) : Promise.resolve(null),
  ]);
  const reviewAccount = reviewAccountId && recon.available ? active.find((a) => a.id === reviewAccountId && (a.owner_scope === "user" || canOffice)) ?? null : null;
  const transferable = active.filter((a) => a.owner_scope === "user" || canOffice).map((a) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, scope: a.owner_scope }));
  // Hareketi tavanı aşan hesapta (null) çizgi yanlış çıkmasın diye hiç çizilmez.
  const series = (a: AccountWithBalance) => {
    if (!finance) return null;
    const m = moves.get(a.id);
    return m === null ? null : dailyBalanceSeries(a.balance, m ?? [], today, 30);
  };
  const statementAccounts = active.filter((a) => a.kind !== "cash" && (a.owner_scope === "user" || canOffice));
  const pendingTotal = recon.available ? [...recon.byAccount.values()].filter((r) => active.some((a) => a.id === r.account_id)).reduce((s, r) => s + r.pending_lines, 0) : 0;
  const officeTry = tryTotal(office, rates);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <AccountFormButton canOffice={canOffice} today={today} />
        <TransferButton accounts={transferable} today={today} />
        {finance ? (
          <Link
            href={`${FINANCE_BASE}?sekme=raporlar&rapor=hesap-ekstresi`}
            className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-xs font-semibold text-accent-text hover:bg-surface-hover touch:min-h-11"
          >
            <FileBarChart className="h-3.5 w-3.5" aria-hidden="true" /> Hesap ekstresi raporu
          </Link>
        ) : null}
        <p className="text-xs text-text-muted">Bakiye = açılış bakiyesi + girişler − çıkışlar. Hesap bakiyesi hareketlerden hesaplanır, elle değiştirilmez.</p>
      </div>

      {finance && office.length > 1 && officeTry !== null ? (
        <Link href={`${FINANCE_BASE}?sekme=hareketler&kaynak=hareket`} className="focus-ring surface-card group flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[var(--radius-panel)] px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">Ofis hesapları toplamı (TL karşılığı)</span>
          <span className="numeric font-display text-xl font-extrabold text-text">{formatAccountMoney(officeTry.total, "TRY")}</span>
          {officeTry.note ? <span className="text-xs text-text-muted">{officeTry.note}</span> : null}
        </Link>
      ) : null}

      {reviewAccount ? (
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          <StatementReview supabase={supabase} account={reviewAccount} canSalary={canSalary} />
        </Suspense>
      ) : null}

      {finance && recon.available && statementAccounts.length > 0 ? (
        <StatementStrip accounts={statementAccounts} recon={recon.byAccount} statementHref={statementHref} pendingTotal={pendingTotal} />
      ) : null}

      {finance && recon.available && pendingTotal > 0 && !reviewAccount ? (
        <section aria-label="İncelenecek" className="grid gap-2">
          <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-text">
            <Inbox className="h-4 w-4 text-accent-text" aria-hidden="true" /> İncelenecek
            <span className="numeric rounded-full bg-surface-accent-soft px-2 text-xs text-accent-text">{pendingTotal}</span>
          </h2>
          <p className="text-xs text-text-muted">Ekstre satırları için önerilen eşleşmeyi tek tıkla onaylayın. Sık gelen açıklamaları kural olarak kaydedin; sonraki ekstrede aynı kategori önerilir.</p>
          <Suspense fallback={<Skeleton className="h-32 w-full" />}>
            <ReconcileQueueSection supabase={supabase} accounts={active.filter((a) => (recon.byAccount.get(a.id)?.pending_lines ?? 0) > 0 && (a.owner_scope === "user" || canOffice))} canSalary={canSalary} canRule={canRule} statementHref={statementHref} />
          </Suspense>
        </section>
      ) : null}

      {finance && commissionCash ? (
        <Suspense fallback={null}>
          <CommissionCashSection supabase={supabase} tenantId={commissionCash} />
        </Suspense>
      ) : null}

      {active.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="İlk hesabınızı açın"
          description="Ofis kasası veya banka hesabı açmak 10 saniye sürer. Açılış bakiyesini girin; sonrasında gelir ve giderleriniz hesaba işlenir."
          tone="amber"
          action={{ node: <AccountFormButton canOffice={canOffice} today={today} /> }}
        />
      ) : null}

      {office.length > 0 ? (
        <Section title="Ofis hesapları" hint="Ofis kasası ve bankaları. Gelir ve giderleri ofis kâr-zararına yansır.">
          {office.map((a) => (
            <AccountCard key={a.id} account={a} recent={recent.get(a.id) ?? []} today={today} canManage={canOffice} canOffice={canOffice} entriesHref={entriesHref} statementHref={statementHref} recon={recon.available ? recon.byAccount.get(a.id) ?? null : undefined} series={series(a)} rates={rates} />
          ))}
        </Section>
      ) : null}

      {personal.length > 0 ? (
        <Section title="Kişisel hesaplarım" hint="Yalnız siz görürsünüz; ofis sahibi dahil kimse göremez ve ofis kâr-zararına girmez." icon={<Lock className="h-3.5 w-3.5" aria-hidden="true" />}>
          {personal.map((a) => (
            <AccountCard key={a.id} account={a} recent={recent.get(a.id) ?? []} today={today} canManage canOffice={canOffice} entriesHref={entriesHref} statementHref={statementHref} recon={recon.available ? recon.byAccount.get(a.id) ?? null : undefined} series={series(a)} rates={rates} />
          ))}
        </Section>
      ) : null}

      {archived.length > 0 ? (
        <details className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-text-muted">Arşivlenen hesaplar ({archived.length})</summary>
          <ul className="mt-3 grid gap-2">
            {archived.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-sm">
                <Link href={entriesHref(a.id)} className="font-semibold text-accent-text hover:underline">{a.name}</Link>
                <span className="numeric text-text-muted">{formatAccountMoney(a.balance, a.currency)}</span>
                {a.owner_scope === "user" || canOffice ? <ArchiveAccountButton accountId={a.id} name={a.name} archived /> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * "Kasaya işle" (SK6/B109): tahsil edildi işaretlenmiş ama kasa hareketi olmayan komisyonlar. Boşsa hiç çizilmez
 * (veri yoksa kart yok). Tutar KDV dahil tahsilattır.
 */
async function CommissionCashSection({ supabase, tenantId }: { supabase: SupabaseClient; tenantId: string }) {
  const gap = await loadCommissionsMissingCash(supabase, tenantId);
  if (!gap.available || gap.rows.length === 0) return null;
  return (
    <section aria-label="Kasaya işlenmemiş komisyon tahsilatları" className="surface-card grid gap-2 rounded-[var(--radius-panel)] p-4">
      <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-text">
        <HandCoins className="h-4 w-4 text-accent-text" aria-hidden="true" /> Kasaya işlenmemiş komisyon tahsilatları
        <span className="numeric rounded-full bg-surface-accent-soft px-2 text-xs text-accent-text">{gap.rows.length}</span>
      </h2>
      <p className="text-xs text-text-muted">
        Bu komisyonlar tahsil edildi olarak işaretlenmiş ama hiçbir hesaba hareket yazılmamış; bakiye eksik görünür. Hesabı seçip kasaya işleyin.
      </p>
      <CommissionCashQueue items={gap.rows} total={gap.total} partial={gap.partial} />
    </section>
  );
}

/** Son 30 günün hareketleri: hesap sayısından bağımsız tek sorgu (bkz. `../kasa-banka/moves.ts`). */
async function loadMoves(supabase: SupabaseClient, accountIds: readonly string[], since: string): Promise<Map<string, DayMove[] | null>> {
  const { moves, error } = await loadMovesForAccounts(supabase, accountIds, since);
  if (error && !isMissingCashSchema(error)) console.error("loadMoves", { message: error.message });
  return moves;
}

/** Döviz -> TL (TCMB satış kuru, tcmb_rates). Kur yoksa null: uydurma kur kullanılmaz. */
function tryOf(a: Pick<AccountWithBalance, "balance" | "currency">, rates: FxRates | null): number | null {
  if (a.currency === "TRY") return a.balance;
  const rate = a.currency === "USD" ? rates?.usd : a.currency === "EUR" ? rates?.eur : null;
  return rate ? Math.round(a.balance * rate * 100) / 100 : null;
}

function tryTotal(accounts: readonly AccountWithBalance[], rates: FxRates | null): { total: number; note: string | null } | null {
  if (accounts.length === 0) return null;
  let total = 0;
  let missing = 0;
  for (const a of accounts) {
    const v = tryOf(a, rates);
    if (v === null) missing += 1;
    else total += v;
  }
  const hasFx = accounts.some((a) => a.currency !== "TRY");
  const note = missing > 0 ? `${missing} döviz hesabı kur bulunamadığı için dahil değil` : hasFx && rates ? `TCMB satış kuru, ${formatDateTr(rates.rateDate)}` : null;
  return { total: Math.round(total * 100) / 100, note };
}

/** Ekstre yükleme şeridi: banka/kart hesabı başına belirgin düğme; henüz hiç ekstre yoksa adımları anlatır. */
function StatementStrip({ accounts, recon, statementHref, pendingTotal }: { accounts: readonly AccountWithBalance[]; recon: Map<string, ReconStatus>; statementHref: (id: string) => string; pendingTotal: number }) {
  const anyImport = accounts.some((a) => recon.get(a.id)?.has_import);
  return (
    <section aria-label="Banka ekstresi" className="surface-card grid gap-3 rounded-[var(--radius-panel)] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-accent-soft text-accent-text">
          <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold text-text">{anyImport ? "Ekstre yükle" : "Bankanızla mutabık kalın"}</h2>
          {anyImport ? (
            <p className="text-xs text-text-muted">
              Yeni ekstreyi yükleyin; kayıtlı hareketler otomatik eşleşir, kalanlar için öneri çıkar.{pendingTotal > 0 ? ` Şu an ${pendingTotal} satır inceleme bekliyor.` : ""}
            </p>
          ) : (
            <ol className="mt-1 grid gap-0.5 text-xs text-text-muted sm:grid-cols-3 sm:gap-3">
              <li><strong className="text-text">1. Yükleyin:</strong> bankanızın internet şubesinden aldığınız CSV, Excel ya da OFX dosyası.</li>
              <li><strong className="text-text">2. Eşleştirin:</strong> kayıtlı hareketler, tahsilatlar ve düzenli ödemeler otomatik bulunur.</li>
              <li><strong className="text-text">3. Onaylayın:</strong> kalan satırlar tek tıkla hesaba işlenir ve mutabık sayılır.</li>
            </ol>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {accounts.map((a) => (
          <StatementUploadButton key={a.id} accountId={a.id} accountName={a.name} reviewHref={statementHref(a.id)} currency={a.currency} prominent />
        ))}
      </div>
    </section>
  );
}

/** Kuyruk verisi: bekleyen satırlar + öneriler (hesap başına paralel; ofis kuralları tek okuma). Akışla gelir (Suspense). */
const QUEUE_LIMIT = 25;
async function ReconcileQueueSection({
  supabase,
  accounts,
  canSalary,
  canRule,
  statementHref,
}: {
  supabase: SupabaseClient;
  accounts: readonly AccountWithBalance[];
  canSalary: boolean;
  canRule: boolean;
  statementHref: (id: string) => string;
}) {
  const financeRules = await loadFinanceRules(supabase);
  const perAccount = await Promise.all(
    accounts.slice(0, 6).map(async (account) => {
      const lines = await loadPendingLines(supabase, account.id);
      if (lines.length === 0) return [] as QueueItem[];
      const ctx = await loadMatchContext(supabase, account.id, lines, account.owner_scope === "office" && account.currency === "TRY");
      const suggestions = suggestAll(lines, { ...ctx, financeRules: account.owner_scope === "office" ? financeRules : [], canSalary });
      return lines.map((l): QueueItem => ({
        lineId: l.id,
        accountId: account.id,
        accountName: account.name,
        currency: account.currency,
        date: l.date,
        dir: l.dir,
        amount: l.amount,
        description: l.description,
        suggestion: suggestions.get(l.id) ?? { kind: "none" },
        fallbackCategory: guessCategory(l.description, l.dir, canSalary).category,
        reviewHref: statementHref(account.id),
        scope: account.owner_scope === "user" ? "personal" : "office",
      }));
    }),
  );
  // Önerisi olan satırlar önce (tek tıkla bitecek iş), sonra yeniden eskiye.
  const all = perAccount.flat().sort((a, b) => Number(b.suggestion.kind !== "none") - Number(a.suggestion.kind !== "none") || b.date.localeCompare(a.date));
  return <ReconcileQueue items={all.slice(0, QUEUE_LIMIT)} total={all.length} canSalary={canSalary} canRule={canRule} />;
}

function Section({ title, hint, icon, children }: { title: string; hint: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-text">{icon}{title}</h2>
      <p className="mb-3 text-xs text-text-muted">{hint}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function AccountCard({
  account: a,
  recent,
  today,
  canManage,
  canOffice,
  entriesHref,
  statementHref,
  recon,
  series,
  rates,
}: {
  entriesHref: (accountId: string) => string;
  statementHref: (accountId: string) => string;
  /** undefined = ekstre özelliği etkin değil (şema yok); null = hesap için durum yok. */
  recon: ReconStatus | null | undefined;
  account: AccountWithBalance;
  recent: CashEntry[];
  today: string;
  canManage: boolean;
  canOffice: boolean;
  /** Son 30 gün gün sonu bakiyeleri (Kasam'da yok). */
  series: { date: string; balance: number }[] | null;
  rates: FxRates | null;
}) {
  const Icon = KIND_ICON[a.kind];
  const negative = a.balance < 0;
  const tl = a.currency !== "TRY" ? tryOf(a, rates) : null;
  // 30 günlük değişim serinin kendi uçlarından: bakiye ileri tarihli hareketleri içerebilir, bugünkü nokta içermez.
  const first = series?.[0]?.balance ?? null;
  const last = series?.[series.length - 1]?.balance ?? null;
  const delta = first !== null && last !== null ? Math.round((last - first) * 100) / 100 : null;
  return (
    <article className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-accent-soft text-accent-text"><Icon className="h-4 w-4" aria-hidden="true" /></span>
          <div className="min-w-0">
            <h3 className="truncate font-display text-sm font-bold text-text">{a.name}</h3>
            <p className="text-xs text-text-muted">
              {ACCOUNT_KIND_LABEL[a.kind]}
              {a.iban_last4 ? ` · •••• ${a.iban_last4}` : ""}
            </p>
          </div>
        </div>
        {a.owner_scope === "user" ? <StatusPill tone="neutral" dot={false}>Kişisel</StatusPill> : null}
      </header>

      <Link href={entriesHref(a.id)} className="focus-ring group -mx-1 flex items-end justify-between gap-3 rounded-[var(--radius-control)] px-1" aria-label={`${a.name} hareketlerini gör`}>
        <span className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">Bakiye</span>
          <span className={`numeric block font-display text-2xl font-extrabold ${negative ? "text-danger-strong" : "text-text"}`}>{formatAccountMoney(a.balance, a.currency)}</span>
          {tl !== null ? <span className="numeric block text-xs text-text-muted">≈ {formatAccountMoney(tl, "TRY")}</span> : null}
          {delta !== null && delta !== 0 ? (
            <span className={`numeric block text-xs ${delta > 0 ? "text-success-strong" : "text-danger-strong"}`}>
              {delta > 0 ? "+" : "−"}
              {formatAccountMoney(Math.abs(delta), a.currency)} son 30 gün
            </span>
          ) : null}
        </span>
        {series ? <AccountSparkline series={series} label={`${a.name}: son 30 gün bakiye çizgisi`} /> : null}
      </Link>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <Link href={`${entriesHref(a.id)}&tur=gelir`} className="focus-ring rounded-[var(--radius-control)] bg-canvas px-2.5 py-1.5 hover:bg-surface-hover">
          <dt className="flex items-center gap-1 text-text-muted"><ArrowDownCircle className="h-3 w-3 text-success-strong" aria-hidden="true" /> Giriş</dt>
          <dd className="numeric font-semibold text-text">{formatAccountMoney(a.total_in, a.currency)}</dd>
        </Link>
        <Link href={`${entriesHref(a.id)}&tur=gider`} className="focus-ring rounded-[var(--radius-control)] bg-canvas px-2.5 py-1.5 hover:bg-surface-hover">
          <dt className="flex items-center gap-1 text-text-muted"><ArrowUpCircle className="h-3 w-3 text-danger-strong" aria-hidden="true" /> Çıkış</dt>
          <dd className="numeric font-semibold text-text">{formatAccountMoney(a.total_out, a.currency)}</dd>
        </Link>
      </dl>

      {recon !== undefined ? <ReconLine account={a} recon={recon} entriesHref={entriesHref} statementHref={statementHref} /> : null}

      <div className="min-w-0">
        <p className="mb-1 text-xs font-semibold text-text-muted">Son hareketler</p>
        {recent.length === 0 ? (
          <p className="text-xs text-text-faint">Henüz hareket yok. Açılış: {formatDateTr(a.opening_date)}.</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {recent.map((e) => (
              <li key={e.id}>
                <Link href={entriesHref(a.id)} className="focus-ring flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-1.5 py-1 text-xs hover:bg-surface-hover">
                  <span className="min-w-0 truncate text-text">{e.title} <span className="text-text-faint">· {cashCategoryLabel(e.category)} · {formatDateTr(e.entry_date)}</span></span>
                  <span className={`numeric shrink-0 font-semibold ${e.direction === "in" ? "text-success-strong" : "text-danger-strong"}`}>
                    {e.direction === "in" ? "+" : "−"}{formatAccountMoney(e.amount, e.currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage ? (
        <footer className="mt-auto flex flex-wrap items-center gap-1 border-t border-line pt-2">
          <AccountFormButton
            canOffice={canOffice}
            today={today}
            account={{ id: a.id, name: a.name, kind: a.kind, currency: a.currency, scope: a.owner_scope, ibanLast4: a.iban_last4, openingBalance: a.opening_balance, openingDate: a.opening_date }}
          />
          {recon !== undefined && a.kind !== "cash" ? <StatementUploadButton accountId={a.id} accountName={a.name} reviewHref={statementHref(a.id)} currency={a.currency} /> : null}
          <ArchiveAccountButton accountId={a.id} name={a.name} archived={false} />
        </footer>
      ) : null}
    </article>
  );
}

/** Mutabakat özeti: son mutabakat tarihi, mutabık olmayan hareket sayısı ve onay bekleyen ekstre satırları (hepsi filtreli hedefe bağlı). */
function ReconLine({ account: a, recon, entriesHref, statementHref }: { account: AccountWithBalance; recon: ReconStatus | null; entriesHref: (accountId: string) => string; statementHref: (accountId: string) => string }) {
  if (!recon || (!recon.has_import && recon.pending_lines === 0)) {
    return a.kind === "cash" ? null : <p className="text-xs text-text-faint">Ekstre yükleyerek hesabı bankanızla mutabık hale getirin.</p>;
  }
  const window = recon.coverage_from && recon.coverage_to ? `&from=${recon.coverage_from}&to=${recon.coverage_to}` : "";
  return (
    <div className="grid gap-1 rounded-[var(--radius-control)] bg-canvas px-2.5 py-2 text-xs">
      <p className="flex items-center gap-1 font-semibold text-text"><ScanLine className="h-3 w-3 text-accent-text" aria-hidden="true" /> Mutabakat</p>
      <p className="text-text-muted">
        Son mutabakat: {recon.last_reconciled_at ? formatDateTr(recon.last_reconciled_at) : "henüz yok"}
      </p>
      {recon.unreconciled_count > 0 ? (
        <Link href={`${entriesHref(a.id)}&mutabik=hayir${window}`} className="focus-ring font-semibold text-warning-strong hover:underline">
          {recon.unreconciled_count} hareket mutabık değil
        </Link>
      ) : recon.has_import ? (
        <p className="text-success-strong">Ekstre dönemindeki tüm hareketler mutabık.</p>
      ) : null}
      {recon.pending_lines > 0 ? (
        <Link href={statementHref(a.id)} className="focus-ring font-semibold text-accent-text hover:underline">
          {recon.pending_lines} ekstre satırı onay bekliyor
        </Link>
      ) : null}
    </div>
  );
}
