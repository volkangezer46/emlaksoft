import Link from "@/components/ui/smart-link";
import { Repeat } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/list-kit";
import { formatDateTr } from "@/lib/format";
import { cashCategoryLabel } from "@/lib/finance/cash/categories";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import type { AccountWithBalance } from "@/lib/finance/cash/load";
import { loadPendingOccurrences, loadRecurringRules, type RecurringRule } from "@/lib/finance/recurring/load";
import { FREQUENCY_LABEL, RULE_MODE_LABEL, payDayLabel } from "@/lib/finance/recurring/rules";
import { PendingActions, RuleFormButton, RuleRowActions } from "../recurring-panel";
import type { AccountOption } from "../quick-entry";

/**
 * Düzenli ödemeler: ad, tutar, sıklık, sonraki tarih, kip. Onay bekleyen taslaklar listenin üstünde (Özet kartı buraya gelir).
 * `scope` ofis sayfasında "office", Kasam'da "user" verilir; Kasam'da ofis kuralı hiç sorgulanmaz.
 */
export async function DuzenliTab({
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
}: {
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
}) {
  const { available, rules } = await loadRecurringRules(supabase, { scope, ownerUserId });
  if (!available) {
    return <EmptyState icon={Repeat} title="Düzenli ödemeler henüz etkin değil" description="Veritabanı güncellemesi uygulandığında bu bölüm açılır." tone="amber" />;
  }
  const pending = await loadPendingOccurrences(supabase, rules);
  const options: AccountOption[] = accounts
    .filter((a) => !a.archived_at && a.owner_scope === scope)
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, scope: a.owner_scope }));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const visible = onlyPending ? rules.filter((r) => pending.some((p) => p.rule_id === r.id)) : rules;
  const allowCreate = canCreate || scope === "user";
  const allowEdit = canEdit || scope === "user";
  const allowDelete = canDelete || scope === "user";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {allowCreate ? <RuleFormButton accounts={options} canSalary={canSalary && scope === "office"} today={today} /> : null}
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
          action={allowCreate ? { node: <RuleFormButton accounts={options} canSalary={canSalary && scope === "office"} today={today} /> } : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
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
                <RuleRow
                  key={r.id}
                  rule={r}
                  accountName={accountById.get(r.account_id)?.name}
                  accountHref={entriesHref(r.account_id)}
                  accounts={options}
                  today={today}
                  canSalary={canSalary && scope === "office"}
                  canEdit={allowEdit}
                  canDelete={allowDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RuleRow({
  rule: r,
  accountName,
  accountHref,
  accounts,
  today,
  canSalary,
  canEdit,
  canDelete,
}: {
  rule: RecurringRule;
  accountName: string | undefined;
  accountHref: string;
  accounts: readonly AccountOption[];
  today: string;
  canSalary: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const ended = !r.active && !r.next_due;
  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-surface-hover/40">
      <td className="px-4 py-3">
        <p className="font-semibold text-text">{r.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          <span>{r.direction === "in" ? "Gelir" : "Gider"} · {cashCategoryLabel(r.category)}</span>
          {accountName ? <Link href={accountHref} className="font-semibold text-accent-text hover:underline">{accountName}</Link> : null}
        </p>
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
          {canEdit && !ended ? (
            <RuleFormButton
              accounts={accounts}
              canSalary={canSalary}
              today={today}
              rule={{ id: r.id, title: r.title, amount: r.amount, accountId: r.account_id, payDay: r.pay_day, endDate: r.end_date, mode: r.mode }}
            />
          ) : null}
          <RuleRowActions ruleId={r.id} title={r.title} active={r.active} canEdit={canEdit && !ended} canDelete={canDelete} />
        </span>
      </td>
    </tr>
  );
}
