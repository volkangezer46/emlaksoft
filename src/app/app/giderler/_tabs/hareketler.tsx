import Link from "@/components/ui/smart-link";
import { ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, Scale } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterDate, FilterGrid, FilterSelect, KpiStrip, ListPager, ListToolbar, StatusPill, type KpiItem } from "@/components/ui/list-kit";
import { buildActiveChips, isoDateParam, pageWindow, parsePage, uuidParam } from "@/components/ui/list-kit/list-logic";
import { buildHref, mergeParams, type ParamRecord } from "@/lib/ui/filter-params";
import { formatDateTr } from "@/lib/format";
import { CASH_CATEGORIES, cashCategoryLabel, SALARY_CATEGORY } from "@/lib/finance/cash/categories";
import { ENTRY_PAGE_SIZE, loadCashEntries, loadCashSummary, type AccountWithBalance, type CashEntry } from "@/lib/finance/cash/load";
import { formatAccountMoney, sumByCurrency } from "@/lib/finance/cash/money";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntryRowActions } from "../entry-actions";
import { FINANCE_BASE } from "./finance-shell";

const TUR_OPTIONS = [
  { value: "", label: "Tümü" },
  { value: "gelir", label: "Gelir" },
  { value: "gider", label: "Gider" },
  { value: "transfer", label: "Transfer" },
] as const;

const hrefWith = (params: ParamRecord, patch: Record<string, string>) =>
  buildHref(FINANCE_BASE, mergeParams({ ...params, sekme: "hareketler" }, patch));

/**
 * Hareketler sekmesi: gelir/gider/transfer defteri. Filtre kontratı: hesap, tür, kategori, tarih aralığı, arama ve sayfa
 * URL'de (?hesap= &tur= &kategori= &from= &to= &q= &sayfa=) tutulur; sunucu sorgusuna aynen yansır, gerçek sayfalama.
 * Kişisel hesap hareketlerini yalnız sahibi, maaş hareketlerini ofis hesaplarında yalnız owner/gm görür (RLS).
 */
export async function HareketlerTab({
  supabase,
  params,
  accounts,
  today,
  canCreate,
  canEdit,
  canDelete,
  canSalary,
}: {
  supabase: SupabaseClient;
  params: ParamRecord;
  accounts: readonly AccountWithBalance[];
  today: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSalary: boolean;
}) {
  const val = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const hesap = uuidParam(params.hesap);
  const accountId = accounts.some((a) => a.id === hesap) ? hesap : "";
  const turRaw = val("tur");
  const tur = turRaw === "gelir" || turRaw === "gider" || turRaw === "transfer" ? turRaw : "";
  const categoryRaw = val("kategori");
  const kategori = CASH_CATEGORIES.some((c) => c.value === categoryRaw) && (canSalary || categoryRaw !== SALARY_CATEGORY) ? categoryRaw : "";
  const from = isoDateParam(params.from);
  const to = isoDateParam(params.to);
  const q = val("q").trim().slice(0, 60);
  const page = parsePage(params.sayfa);

  const [{ entries, total }, summary] = await Promise.all([
    loadCashEntries(supabase, { accountId: accountId || null, tur: tur || null, category: kategori || null, from: from || null, to: to || null, q: q || null, page }),
    loadCashSummary(supabase, { from: from || null, to: to || null }),
  ]);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const inScope = summary.filter((s) => !accountId || s.account_id === accountId).filter((s) => !kategori || s.category === kategori);
  const sumOf = (dir: "in" | "out") =>
    sumByCurrency(inScope.filter((s) => s.direction === dir).map((s) => ({ currency: accountById.get(s.account_id)?.currency ?? "TRY", amount: s.total })));
  const incomes = sumOf("in");
  const expenses = sumOf("out");
  const money = (rows: { currency: string; amount: number }[]) => (rows.length === 0 ? formatAccountMoney(0, "TRY") : rows.map((r) => formatAccountMoney(r.amount, r.currency)).join(" · "));
  const net = sumByCurrency([...incomes, ...expenses.map((e) => ({ currency: e.currency, amount: -e.amount }))]);

  const kpis: KpiItem[] = [
    { label: "Gelir", value: money(incomes), icon: <ArrowDownCircle />, tone: "success", href: hrefWith(params, { tur: "gelir", sayfa: "" }), hint: from || to ? "seçili aralık" : "tüm zamanlar" },
    { label: "Gider", value: money(expenses), icon: <ArrowUpCircle />, tone: "warning", href: hrefWith(params, { tur: "gider", sayfa: "" }), hint: from || to ? "seçili aralık" : "tüm zamanlar" },
    { label: "Net", value: money(net), icon: <Scale />, tone: "info", href: hrefWith(params, { tur: "", sayfa: "" }), hint: "gelir - gider (transfer hariç)" },
  ];

  const pathParams: ParamRecord = { ...params, sekme: "hareketler" };
  const chips = buildActiveChips(FINANCE_BASE, pathParams, [
    { key: "hesap", label: "Hesap", format: () => accountById.get(accountId)?.name ?? "Seçili hesap" },
    { key: "tur", label: "Tür", format: (v) => TUR_OPTIONS.find((o) => o.value === v)?.label ?? v },
    { key: "kategori", label: "Kategori", format: (v) => cashCategoryLabel(v) },
    { key: "from", label: "Başlangıç", format: (v) => formatDateTr(v) },
    { key: "to", label: "Bitiş", format: (v) => formatDateTr(v) },
    { key: "q", label: "Arama" },
  ]).filter((c) => (c.key === "hesap" ? Boolean(accountId) : c.key === "tur" ? Boolean(tur) : c.key === "kategori" ? Boolean(kategori) : true));

  const w = pageWindow(page, total, ENTRY_PAGE_SIZE, entries.length);
  const categoryOptions = [
    { value: "", label: "Tümü" },
    ...CASH_CATEGORIES.filter((c) => canSalary || c.value !== SALARY_CATEGORY).map((c) => ({ value: c.value, label: c.label })),
  ];

  return (
    <div className="grid gap-4">
      <KpiStrip items={kpis} />

      <ListToolbar
        pathname={FINANCE_BASE}
        params={pathParams}
        searchPlaceholder="Açıklama veya karşı taraf ara…"
        searchLabel="Hareketlerde ara"
        panelParamKeys={["hesap", "tur", "kategori", "from", "to"]}
        panel={
          <FilterGrid>
            <FilterSelect name="hesap" label="Hesap" value={accountId} options={[{ value: "", label: "Tüm hesaplar" }, ...accounts.map((a) => ({ value: a.id, label: `${a.name}${a.owner_scope === "user" ? " (kişisel)" : ""}` }))]} />
            <FilterSelect name="tur" label="Tür" value={tur} options={TUR_OPTIONS} />
            <FilterSelect name="kategori" label="Ne için" value={kategori} options={categoryOptions} />
            <span />
            <FilterDate name="from" label="Başlangıç" value={from} />
            <FilterDate name="to" label="Bitiş" value={to} />
          </FilterGrid>
        }
        chips={chips}
        resultCount={total}
        resultNoun="hareket"
      />

      {entries.length === 0 ? (
        chips.length > 0 ? (
          <div className="grid place-items-center rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
            <h2 className="font-display text-lg font-bold text-text">Bu filtreyle hareket yok</h2>
            <Link href={`${FINANCE_BASE}?sekme=hareketler`} className="mt-2 text-sm font-semibold text-accent-text hover:underline">
              Filtreleri temizle
            </Link>
          </div>
        ) : (
          <EmptyState
            icon={ArrowLeftRight}
            title="Henüz hareket yok"
            description={accounts.length === 0 ? "Önce bir hesap açın (ör. ofis kasası), sonra gelir ve giderlerinizi ekleyin." : "Sayfanın üstündeki Gelir ekle veya Gider ekle düğmesiyle ilk hareketi girin."}
            tone="amber"
            action={accounts.length === 0 ? { href: `${FINANCE_BASE}?sekme=kasa-banka`, label: "İlk hesabı aç" } : undefined}
          />
        )
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Para hareketleri</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">
                <th scope="col" className="px-4 py-2.5">Tarih</th>
                <th scope="col" className="px-4 py-2.5">Ne için</th>
                <th scope="col" className="px-4 py-2.5">Hesap</th>
                <th scope="col" className="px-4 py-2.5 text-right">Tutar</th>
                <th scope="col" className="px-4 py-2.5 text-right"><span className="sr-only">İşlemler</span></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} account={accountById.get(e.account_id)} today={today} canEdit={canEdit} canDelete={canDelete} canSalary={canSalary} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ListPager pathname={FINANCE_BASE} params={pathParams} window={w} total={total} />
      {!canCreate && accounts.length > 0 ? <p className="text-xs text-text-faint">Bu ekranda yalnız görüntüleme yetkiniz var.</p> : null}
    </div>
  );
}

function EntryRow({
  entry: e,
  account,
  today,
  canEdit,
  canDelete,
  canSalary,
}: {
  entry: CashEntry;
  account: AccountWithBalance | undefined;
  today: string;
  canEdit: boolean;
  canDelete: boolean;
  canSalary: boolean;
}) {
  const personal = account?.owner_scope === "user";
  const isTransfer = e.kind === "transfer";
  const sign = e.direction === "in" ? "+" : "−";
  const manual = e.source_type === "manual" && (e.kind === "income" || e.kind === "expense");
  // Kişisel hesabın hareketini yalnız sahibi görür: düzenleme/iptal onda da açıktır (RPC doğrular).
  const mayEdit = manual && (personal || canEdit);
  const mayVoid = personal || canDelete;
  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-surface-hover/40">
      <td className="numeric whitespace-nowrap px-4 py-3 text-text-muted">{formatDateTr(e.entry_date)}</td>
      <td className="px-4 py-3">
        <p className="font-semibold text-text">{e.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          <span>{cashCategoryLabel(e.category)}</span>
          {e.counterparty ? <span>· {e.counterparty}</span> : null}
          {e.source_type !== "manual" ? <StatusPill tone="info" dot={false}>{SOURCE_LABEL[e.source_type] ?? e.source_type}</StatusPill> : null}
          {e.document_url ? (
            <a href={e.document_url} target="_blank" rel="noreferrer noopener" className="font-semibold text-accent-text hover:underline">Belge</a>
          ) : null}
        </p>
      </td>
      <td className="px-4 py-3">
        {account ? (
          <Link href={`${FINANCE_BASE}?sekme=hareketler&hesap=${account.id}`} className="font-medium text-accent-text hover:underline">
            {account.name}
          </Link>
        ) : (
          <span className="text-text-faint">—</span>
        )}
        {personal ? <StatusPill tone="neutral" dot={false} className="ml-1.5">Kişisel</StatusPill> : null}
      </td>
      <td className={`numeric whitespace-nowrap px-4 py-3 text-right font-bold ${isTransfer ? "text-text" : e.direction === "in" ? "text-success-strong" : "text-danger-strong"}`}>
        {sign}
        {formatAccountMoney(e.amount, e.currency)}
      </td>
      <td className="px-4 py-3">
        {mayEdit || mayVoid ? (
          <EntryRowActions
            entry={{ id: e.id, direction: e.direction, amount: e.amount, date: e.entry_date, category: e.category, title: e.title, counterparty: e.counterparty, note: e.note }}
            today={today}
            canEdit={mayEdit}
            canVoid={mayVoid}
            canSalary={canSalary}
            isTransfer={isTransfer}
          />
        ) : null}
      </td>
    </tr>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  commission: "Komisyon tahsilatı",
  rent: "Kira tahsilatı",
  building: "Aidat tahsilatı",
  due: "Aidat",
  recurring: "Düzenli ödeme",
  import: "Ekstreden",
};
