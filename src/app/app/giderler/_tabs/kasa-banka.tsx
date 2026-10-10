import Link from "@/components/ui/smart-link";
import { ArrowDownCircle, ArrowUpCircle, Banknote, CreditCard, Landmark, Lock, Wallet } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/list-kit";
import { formatDateTr } from "@/lib/format";
import { cashCategoryLabel } from "@/lib/finance/cash/categories";
import { ACCOUNT_KIND_LABEL } from "@/lib/finance/cash/input";
import { loadRecentEntriesByAccount, type AccountWithBalance, type CashEntry } from "@/lib/finance/cash/load";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { AccountFormButton, ArchiveAccountButton, TransferButton } from "../accounts-panel";
import { FINANCE_BASE } from "./finance-shell";

const KIND_ICON = { cash: Banknote, bank: Landmark, card: CreditCard } as const;

const hareketlerHref = (accountId: string) => `${FINANCE_BASE}?sekme=hareketler&hesap=${accountId}`;

/**
 * Kasa ve banka sekmesi: hesap kartları (bakiye, son hareketler). Bakiye ve her hareket filtreli Hareketler sekmesine gider
 * (sıfır çıkmaz metrik). Kişisel hesaplar ayrı bölümde ve yalnız sahibine görünür (RLS).
 */
export async function KasaBankaTab({
  supabase,
  accounts,
  today,
  canOffice,
}: {
  supabase: SupabaseClient;
  accounts: readonly AccountWithBalance[];
  today: string;
  /** `expenses` oluşturma/düzenleme yetkisi: ofis hesabı açabilir ve düzenleyebilir. */
  canOffice: boolean;
}) {
  const active = accounts.filter((a) => !a.archived_at);
  const archived = accounts.filter((a) => a.archived_at);
  const office = active.filter((a) => a.owner_scope === "office");
  const personal = active.filter((a) => a.owner_scope === "user");
  const recent = await loadRecentEntriesByAccount(supabase, active.map((a) => a.id), 3);
  const transferable = active.filter((a) => a.owner_scope === "user" || canOffice).map((a) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, scope: a.owner_scope }));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <AccountFormButton canOffice={canOffice} today={today} />
        <TransferButton accounts={transferable} today={today} />
        <p className="text-xs text-text-muted">Bakiye = açılış bakiyesi + girişler − çıkışlar. Hesap bakiyesi hareketlerden hesaplanır, elle değiştirilmez.</p>
      </div>

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
            <AccountCard key={a.id} account={a} recent={recent.get(a.id) ?? []} today={today} canManage={canOffice} canOffice={canOffice} />
          ))}
        </Section>
      ) : null}

      {personal.length > 0 ? (
        <Section title="Kişisel hesaplarım" hint="Yalnız siz görürsünüz; ofis sahibi dahil kimse göremez ve ofis kâr-zararına girmez." icon={<Lock className="h-3.5 w-3.5" aria-hidden="true" />}>
          {personal.map((a) => (
            <AccountCard key={a.id} account={a} recent={recent.get(a.id) ?? []} today={today} canManage canOffice={canOffice} />
          ))}
        </Section>
      ) : null}

      {archived.length > 0 ? (
        <details className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-text-muted">Arşivlenen hesaplar ({archived.length})</summary>
          <ul className="mt-3 grid gap-2">
            {archived.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-sm">
                <Link href={hareketlerHref(a.id)} className="font-semibold text-accent-text hover:underline">{a.name}</Link>
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
}: {
  account: AccountWithBalance;
  recent: CashEntry[];
  today: string;
  canManage: boolean;
  canOffice: boolean;
}) {
  const Icon = KIND_ICON[a.kind];
  const negative = a.balance < 0;
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

      <Link href={hareketlerHref(a.id)} className="focus-ring group rounded-[var(--radius-control)] -mx-1 px-1" aria-label={`${a.name} hareketlerini gör`}>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">Bakiye</p>
        <p className={`numeric font-display text-2xl font-extrabold ${negative ? "text-danger-strong" : "text-text"}`}>{formatAccountMoney(a.balance, a.currency)}</p>
      </Link>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <Link href={`${hareketlerHref(a.id)}&tur=gelir`} className="focus-ring rounded-[var(--radius-control)] bg-canvas px-2.5 py-1.5 hover:bg-surface-hover">
          <dt className="flex items-center gap-1 text-text-muted"><ArrowDownCircle className="h-3 w-3 text-success-strong" aria-hidden="true" /> Giriş</dt>
          <dd className="numeric font-semibold text-text">{formatAccountMoney(a.total_in, a.currency)}</dd>
        </Link>
        <Link href={`${hareketlerHref(a.id)}&tur=gider`} className="focus-ring rounded-[var(--radius-control)] bg-canvas px-2.5 py-1.5 hover:bg-surface-hover">
          <dt className="flex items-center gap-1 text-text-muted"><ArrowUpCircle className="h-3 w-3 text-danger-strong" aria-hidden="true" /> Çıkış</dt>
          <dd className="numeric font-semibold text-text">{formatAccountMoney(a.total_out, a.currency)}</dd>
        </Link>
      </dl>

      <div>
        <p className="mb-1 text-xs font-semibold text-text-muted">Son hareketler</p>
        {recent.length === 0 ? (
          <p className="text-xs text-text-faint">Henüz hareket yok. Açılış: {formatDateTr(a.opening_date)}.</p>
        ) : (
          <ul className="grid gap-1">
            {recent.map((e) => (
              <li key={e.id}>
                <Link href={hareketlerHref(a.id)} className="focus-ring flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-1.5 py-1 text-xs hover:bg-surface-hover">
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
          <ArchiveAccountButton accountId={a.id} name={a.name} archived={false} />
        </footer>
      ) : null}
    </article>
  );
}
