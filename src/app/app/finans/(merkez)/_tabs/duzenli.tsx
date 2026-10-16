import { financeHref, financePath, financePartyHref } from "@/lib/finance/routes";
import Link from "@/components/ui/smart-link";
import { CalendarClock, Hourglass, Repeat, TrendingDown } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiStrip, MobileCard, MobileCardList, StatusPill, type KpiItem } from "@/components/ui/list-kit";
import { formatDateTr } from "@/lib/format";
import { now, trDayKey } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { cashCategoryLabel } from "@/lib/finance/cash/categories";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { loadAccountsWithBalances, type AccountWithBalance } from "@/lib/finance/cash/load";
import { loadPendingOccurrences, loadRecurringRules, type RecurringRule } from "@/lib/finance/recurring/load";
import { FREQUENCY_LABEL, RULE_MODE_LABEL, payDayLabel } from "@/lib/finance/recurring/rules";
import { monthlyEquivalent } from "@/lib/finance/recurring-expenses";
import { rentWithholdingBreakdown } from "@/lib/finance/expense-budget";
import type { EditableRule, RulePartyOption } from "../recurring-panel";
import { PendingActions, RuleFormButton, RuleRowActions } from "../_lazy";
import type { AccountOption } from "../quick-entry";
import { PARTY_KIND_LABEL, type FinanceTabProps } from "./butce";

/** Eski çağrı biçimi (Kasam ve FN2 öncesi sayfa): veri çağırandan gelir. */
type LegacyDuzenliProps = {
  supabase: SupabaseClient;
  accounts: readonly AccountWithBalance[];
  scope: "office" | "user";
  ownerUserId?: string;
  today: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSalary: boolean;
  entriesHref: (accountId: string) => string;
  /** ?durum=bekleyen: yalnız onay bekleyenler. */
  onlyPending?: boolean;
};

const officeEntriesHref = (id: string) => `${financePath("hareketler")}?hesap=${id}`;

/**
 * Tekrarlayanlar sekmesi (?sekme=duzenli): düzenli ödeme/gelir kuralları, onay bekleyenler ve aylık yük özeti.
 * Muhasebe v2 sözleşmesi `DuzenliTab(props: FinanceTabProps)`: sekme kendi verisini çeker. Kasam (`scope="user"`) eski
 * çağrı biçimiyle aynen çalışır; Kasam'da ofis kuralı ve ofis carisi hiç sorgulanmaz.
 */
export async function DuzenliTab(props: FinanceTabProps | LegacyDuzenliProps) {
  if ("supabase" in props) return <DuzenliView {...props} />;
  const supabase = await createClient();
  const cash = await loadAccountsWithBalances(supabase);
  return (
    <DuzenliView
      supabase={supabase}
      accounts={cash.accounts}
      scope="office"
      today={trDayKey(now())}
      canCreate={props.canCreate}
      canEdit={props.canEdit}
      canDelete={props.canDelete}
      canSalary={props.canSalary}
      entriesHref={officeEntriesHref}
      onlyPending={props.params.durum === "bekleyen"}
    />
  );
}

type RuleTerms = { partyId: string | null; vatRate: number | null; withholdingRate: number | null };

/** Ofis kurallarının cari/KDV/stopaj koşulları (FN1 sütunları yoksa boş: sekme eski haliyle çalışır). */
async function loadRuleTerms(supabase: SupabaseClient, ids: readonly string[]): Promise<Map<string, RuleTerms>> {
  const out = new Map<string, RuleTerms>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from("recurring_rules").select("id, party_id, vat_rate, withholding_rate").in("id", ids.slice(0, 500));
  if (error) return out;
  for (const r of (data ?? []) as { id: string; party_id: string | null; vat_rate: number | string | null; withholding_rate: number | string | null }[]) {
    out.set(r.id, {
      partyId: r.party_id,
      vatRate: r.vat_rate == null ? null : Number(r.vat_rate),
      withholdingRate: r.withholding_rate == null ? null : Number(r.withholding_rate),
    });
  }
  return out;
}

async function loadPartyOptions(supabase: SupabaseClient): Promise<RulePartyOption[] | null> {
  const { data, error } = await supabase.from("finance_parties").select("id, name, kind").is("archived_at", null).order("name", { ascending: true }).limit(500);
  if (error) return null;
  return ((data ?? []) as { id: string; name: string; kind: string }[]).map((p) => ({ id: p.id, name: p.name, kindLabel: PARTY_KIND_LABEL[p.kind] ?? "Kişi / firma" }));
}

async function DuzenliView({
  supabase,
  accounts,
  scope,
  ownerUserId,
  today,
  canCreate,
  canEdit,
  canDelete,
  canSalary,
  entriesHref,
  onlyPending = false,
}: LegacyDuzenliProps) {
  const { available, rules } = await loadRecurringRules(supabase, { scope, ownerUserId });
  if (!available) {
    return <EmptyState icon={Repeat} title="Düzenli ödemeler henüz etkin değil" description="Veritabanı güncellemesi uygulandığında bu bölüm açılır." tone="amber" />;
  }
  const office = scope === "office";
  // Bekleyenler, koşullar ve cariler birbirinden bağımsız: tek turda.
  const [pending, terms, parties] = await Promise.all([
    loadPendingOccurrences(supabase, rules),
    office ? loadRuleTerms(supabase, rules.map((r) => r.id)) : Promise.resolve(new Map<string, RuleTerms>()),
    office ? loadPartyOptions(supabase) : Promise.resolve(null),
  ]);
  const options: AccountOption[] = accounts
    .filter((a) => !a.archived_at && a.owner_scope === scope)
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, scope: a.owner_scope }));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));
  const visible = onlyPending ? rules.filter((r) => pending.some((p) => p.rule_id === r.id)) : rules;
  const allowCreate = canCreate || scope === "user";
  const allowEdit = canEdit || scope === "user";
  const allowDelete = canDelete || scope === "user";
  // Ofis sekmesinde cari/KDV/stopaj alanları yalnız şema (finance_parties) varken açılır.
  const partyOptions = office && parties ? parties : undefined;
  const salary = canSalary && office;

  const active = rules.filter((r) => r.active && r.next_due);
  const monthlyOut = active.filter((r) => r.direction === "out").reduce((s, r) => s + monthlyEquivalent(r.amount, r.frequency), 0);
  const monthlyIn = active.filter((r) => r.direction === "in").reduce((s, r) => s + monthlyEquivalent(r.amount, r.frequency), 0);
  const base = financePath("tekrarlayan");
  const kpis: KpiItem[] = [
    { label: "Aktif düzenli kayıt", value: active.length, icon: <Repeat />, tone: "info", href: base, hint: `${rules.length} tanım` },
    { label: "Aylık düzenli gider", value: formatAccountMoney(Math.round(monthlyOut), "TRY"), icon: <TrendingDown />, tone: "warning", href: base, hint: monthlyIn > 0 ? `gelir ${formatAccountMoney(Math.round(monthlyIn), "TRY")}` : "aylık eşdeğer" },
    { label: "Onay bekleyen", value: pending.length, icon: <Hourglass />, tone: pending.length > 0 ? "danger" : "neutral", href: financeHref("tekrarlayan", { durum: "bekleyen" }), hint: "Bana sor ödemeleri", attention: pending.length > 0 },
  ];

  const editable = (r: RecurringRule): EditableRule => {
    const t = terms.get(r.id);
    return { id: r.id, title: r.title, amount: r.amount, accountId: r.account_id, payDay: r.pay_day, endDate: r.end_date, mode: r.mode, partyId: t?.partyId ?? null, vatRate: t?.vatRate ?? null, withholdingRate: t?.withholdingRate ?? null };
  };
  const rowProps = (r: RecurringRule) => ({
    rule: r,
    editable: editable(r),
    terms: terms.get(r.id) ?? null,
    partyLabel: terms.get(r.id)?.partyId ? (partyName.get(terms.get(r.id)!.partyId!) ?? null) : null,
    accountName: accountById.get(r.account_id)?.name,
    accountHref: entriesHref(r.account_id),
    accounts: options,
    parties: partyOptions,
    today,
    canSalary: salary,
    canEdit: allowEdit,
    canDelete: allowDelete,
  });

  return (
    <div className="grid gap-6">
      {office && rules.length > 0 ? <KpiStrip items={kpis} label="Düzenli ödeme özeti" /> : null}
      <div className="flex flex-wrap items-center gap-2">
        {allowCreate ? <RuleFormButton accounts={options} canSalary={salary} today={today} parties={partyOptions} /> : null}
        {allowCreate && office ? (
          <RuleFormButton accounts={options} canSalary={salary} today={today} parties={partyOptions ?? []} template="stopajli_kira" label="Stopajlı ofis kirası" />
        ) : null}
        <p className="text-xs text-text-muted">
          Kira, portal üyeliği, muhasebe, maaş gibi her ay tekrarlayan ödemeleri bir kez tanımlayın. Geçmiş aylar için kayıt açılmaz.
        </p>
      </div>

      {pending.length > 0 ? (
        <section aria-label="Onay bekleyen ödemeler" id="bekleyen" className="rounded-[var(--radius-panel)] border border-warning-200 bg-surface p-4 shadow-[var(--shadow-xs)]">
          <h2 className="font-display text-base font-bold text-text">Onay bekleyen {pending.length} ödeme</h2>
          <p className="mb-3 text-xs text-text-muted">Vadesi gelen “Bana sor” ödemeleri. Onaylayınca hesaba işlenir.</p>
          <ul className="grid gap-2">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-text">{p.title}</span>
                  <span className="ml-2 text-xs text-text-muted">vade {formatDateTr(p.due_date)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className={`numeric font-bold ${p.direction === "in" ? "text-success-strong" : "text-danger-strong"}`}>{formatAccountMoney(p.amount, "TRY")}</span>
                  {allowCreate ? <PendingActions occurrenceId={p.id} title={p.title} amount={p.amount} /> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : onlyPending ? (
        <p className="text-sm text-text-muted">Onay bekleyen ödeme yok.</p>
      ) : null}

      {rules.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="Henüz düzenli ödeme yok"
          description="Ofis kirası, portal üyeliği veya muhasebe ücreti gibi her ay aynı gün ödediklerinizi tanımlayın; hesaba kendiliğinden işlensin ya da size sorulsun."
          tone="amber"
          action={allowCreate ? { node: <RuleFormButton accounts={options} canSalary={salary} today={today} parties={partyOptions} /> } : undefined}
        />
      ) : (
        <>
          <MobileCardList aria-label="Düzenli ödemeler">
            {visible.map((r) => (
              <RuleCard key={r.id} {...rowProps(r)} />
            ))}
          </MobileCardList>
          <div className="hidden overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface md:block">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Düzenli ödemeler</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">
                  <th scope="col" className="px-4 py-2.5">Ad</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Tutar</th>
                  <th scope="col" className="px-4 py-2.5">Sıklık</th>
                  <th scope="col" className="px-4 py-2.5">Sonraki tarih</th>
                  <th scope="col" className="px-4 py-2.5">Kip</th>
                  <th scope="col" className="px-4 py-2.5 text-right"><span className="sr-only">İşlemler</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <RuleRow key={r.id} {...rowProps(r)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {office && rules.length > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-text-faint">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Aylık eşdeğer: 3 aylık ve yıllık ödemeler aylara bölünür. Stopajlı kirada brüt tutar kaydedilir; net ve stopaj ayrıca gösterilir.
        </p>
      ) : null}
    </div>
  );
}

type RowProps = {
  rule: RecurringRule;
  editable: EditableRule;
  terms: RuleTerms | null;
  partyLabel: string | null;
  accountName: string | undefined;
  accountHref: string;
  accounts: readonly AccountOption[];
  parties: readonly RulePartyOption[] | undefined;
  today: string;
  canSalary: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

/** Cari + KDV + stopaj alt satırı (yalnız koşul varsa). */
function TermsLine({ rule: r, terms, partyLabel }: Pick<RowProps, "rule" | "terms" | "partyLabel">) {
  if (!terms || (!terms.partyId && !terms.vatRate && !terms.withholdingRate)) return null;
  const wh = terms.withholdingRate ? rentWithholdingBreakdown(r.amount, terms.withholdingRate) : null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
      {terms.partyId && partyLabel ? (
        <Link href={financePartyHref(terms.partyId)} className="font-semibold text-accent-text hover:underline">
          {partyLabel}
        </Link>
      ) : null}
      {terms.vatRate ? <StatusPill tone="neutral" dot={false}>KDV %{terms.vatRate}</StatusPill> : null}
      {wh && wh.withheld > 0 ? (
        <span className="numeric">
          brüt {formatAccountMoney(wh.gross, "TRY")} · stopaj %{terms.withholdingRate} {formatAccountMoney(wh.withheld, "TRY")} · net {formatAccountMoney(wh.net, "TRY")}
        </span>
      ) : null}
    </span>
  );
}

function RuleRow({ rule: r, editable, terms, partyLabel, accountName, accountHref, accounts, parties, today, canSalary, canEdit, canDelete }: RowProps) {
  const ended = !r.active && !r.next_due;
  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-surface-hover/40">
      <td className="px-4 py-3">
        <p className="font-semibold text-text">{r.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          <span>{r.direction === "in" ? "Gelir" : "Gider"} · {cashCategoryLabel(r.category)}</span>
          {accountName ? <Link href={accountHref} className="font-semibold text-accent-text hover:underline">{accountName}</Link> : null}
        </p>
        <TermsLine rule={r} terms={terms} partyLabel={partyLabel} />
      </td>
      <td className={`numeric whitespace-nowrap px-4 py-3 text-right font-bold ${r.direction === "in" ? "text-success-strong" : "text-danger-strong"}`}>
        {r.direction === "in" ? "+" : "−"}
        {formatAccountMoney(r.amount, "TRY")}
      </td>
      <td className="px-4 py-3 text-text-muted">
        {FREQUENCY_LABEL[r.frequency]}
        <span className="block text-xs">{payDayLabel(r.pay_day)}</span>
      </td>
      <td className="numeric whitespace-nowrap px-4 py-3 text-text">
        {r.next_due && r.active ? formatDateTr(r.next_due) : <span className="text-text-faint">{ended ? "Tamamlandı" : "Durduruldu"}</span>}
      </td>
      <td className="px-4 py-3">
        <StatusPill tone={r.mode === "auto" ? "success" : "info"} dot={false}>{RULE_MODE_LABEL[r.mode]}</StatusPill>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="inline-flex flex-wrap items-center justify-end gap-1">
          {canEdit && !ended ? <RuleFormButton accounts={accounts} canSalary={canSalary} today={today} rule={editable} parties={parties} /> : null}
          <RuleRowActions ruleId={r.id} title={r.title} active={r.active} canEdit={canEdit && !ended} canDelete={canDelete} />
        </span>
      </td>
    </tr>
  );
}

function RuleCard({ rule: r, editable, terms, partyLabel, accountName, accountHref, accounts, parties, today, canSalary, canEdit, canDelete }: RowProps) {
  const ended = !r.active && !r.next_due;
  return (
    <MobileCard>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold text-text">{r.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
            <span>{r.direction === "in" ? "Gelir" : "Gider"} · {cashCategoryLabel(r.category)}</span>
            {accountName ? <Link href={accountHref} className="font-semibold text-accent-text hover:underline">{accountName}</Link> : null}
          </p>
          <TermsLine rule={r} terms={terms} partyLabel={partyLabel} />
        </div>
        <p className={`numeric shrink-0 text-right font-bold ${r.direction === "in" ? "text-success-strong" : "text-danger-strong"}`}>
          {r.direction === "in" ? "+" : "−"}
          {formatAccountMoney(r.amount, "TRY")}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
        <span>{FREQUENCY_LABEL[r.frequency]} · {payDayLabel(r.pay_day)}</span>
        <span className="numeric">· {r.next_due && r.active ? formatDateTr(r.next_due) : ended ? "Tamamlandı" : "Durduruldu"}</span>
        <StatusPill tone={r.mode === "auto" ? "success" : "info"} dot={false}>{RULE_MODE_LABEL[r.mode]}</StatusPill>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1 border-t border-line pt-2">
        {canEdit && !ended ? <RuleFormButton accounts={accounts} canSalary={canSalary} today={today} rule={editable} parties={parties} /> : null}
        <RuleRowActions ruleId={r.id} title={r.title} active={r.active} canEdit={canEdit && !ended} canDelete={canDelete} />
      </div>
    </MobileCard>
  );
}
