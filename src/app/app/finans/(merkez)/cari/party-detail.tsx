import Link from "@/components/ui/smart-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlarmClock, ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, Mail, Phone, Receipt, Scale, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterDate, KpiStrip, MobileCard, MobileCardList, StatusPill, type KpiItem } from "@/components/ui/list-kit";
import { isoDateParam } from "@/components/ui/list-kit/list-logic";
import { formatDateTr } from "@/lib/format";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import {
  agingFromItems,
  balanceCaption,
  closingBalance,
  fromKurus,
  normalizeStatementLine,
  num,
  partyKindLabel,
  partyKindOf,
  statementDocLabel,
  statementRpcArgs,
  toKurus,
  type StatementLine,
} from "@/lib/finance/party/aging";
import { OWNER_STATEMENT_MAX_ROWS, loadOwnerStatement, type OwnerStatement } from "@/lib/finance/party/owner-statement";
import { formatPhoneDisplay } from "@/lib/phone";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { OpenItemsTable, loadOpenItemRows } from "./open-items";
import { PartyFormButton, type EditableParty } from "./party-form";
import { BalanceCell, cariHref } from "./party-list";
import { earningsPath, financeHref, financePartyHref, financePath } from "@/lib/finance/routes";
import { NewOpenItemButton, type SettleAccount } from "./settle-dialog";

/**
 * Cari detayı (?sekme=cari&cari=<id>): başlık + bakiye KPI'ları, açık kalemler (Tahsil et / Öde), cari ekstresi
 * (`finance_party_statement`, yürüyen bakiye; her satır kaynağına bağlı) ve türe özel bölüm:
 *  - Malik: tahsil edilen kira − yönetim ücreti − masraf − stopaj = hak ediş; ödenen düşülünce ödenecek (yalnız gösterim).
 *  - Danışman: prim hak edişi ve ödenen (commission_splits). P12: başka danışmanın carisi `earnings_all` olmadan açılmaz.
 * Bakiye = ekstrenin son yürüyen bakiyesi (tarih süzgeci yokken); liste bakiyesiyle aynı kaynaktır.
 */

const PARTY_COLUMNS = "id, kind, name, tax_id, iban_last4, phone, email, note, customer_id, user_id, archived_at";

type PartyRecord = EditableParty;

/** Düzenleme formundaki bağ seçicileri için bağlı müşteri / kullanıcının adı (yalnız düzenleme yetkisi varsa okunur). */
async function loadLinkLabels(supabase: SupabaseClient, party: PartyRecord): Promise<{ customer: string | null; user: string | null }> {
  const [c, u] = await Promise.all([
    party.customer_id ? supabase.from("customers").select("full_name").eq("id", party.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    party.user_id ? supabase.from("profiles").select("full_name").eq("id", party.user_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    customer: (c.data as { full_name?: string | null } | null)?.full_name ?? null,
    user: (u.data as { full_name?: string | null } | null)?.full_name ?? null,
  };
}

/** Tek danışmanın komisyon payı okumasının açık üst sınırı (satır); aşılırsa `truncated` ile arayüzde söylenir. */
const ADVISOR_SPLITS_MAX_ROWS = 20_000;

type AdvisorEarnings = { available: boolean; earned: number; paid: number; pending: number; count: number; truncated: boolean };

async function loadAdvisorEarnings(supabase: SupabaseClient, tenantId: string, profileId: string | null): Promise<AdvisorEarnings> {
  const empty = { available: false, earned: 0, paid: 0, pending: 0, count: 0, truncated: false };
  if (!profileId) return empty;
  const splits = await readAllPaged<{ commission_id: string; amount: unknown }>(
    (from, to) => supabase.from("commission_splits").select("commission_id, amount").eq("tenant_id", tenantId).eq("profile_id", profileId).order("id").range(from, to),
    { maxRows: ADVISOR_SPLITS_MAX_ROWS },
  );
  if (splits.error) return empty;
  const rows = splits.rows;
  if (rows.length === 0) return { ...empty, available: true };
  const ids = [...new Set(rows.map((r) => r.commission_id))];
  const status = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const res = await supabase.from("commissions").select("id, status").eq("tenant_id", tenantId).in("id", ids.slice(i, i + 200));
    if (res.error) return empty;
    for (const c of (res.data ?? []) as { id: string; status: string }[]) status.set(c.id, c.status);
  }
  let earnedK = 0;
  let paidK = 0;
  let count = 0;
  for (const r of rows) {
    const st = status.get(r.commission_id);
    if (!st || st === "cancelled") continue;
    const k = toKurus(r.amount);
    earnedK += k;
    count += 1;
    if (st === "paid") paidK += k;
  }
  return { available: true, earned: fromKurus(earnedK), paid: fromKurus(paidK), pending: fromKurus(earnedK - paidK), count, truncated: splits.truncated };
}

export async function PartyDetail({
  supabase,
  partyId,
  params,
  today,
  tenantId,
  userId,
  earningsAll,
  accounts,
  canCreate,
  canEdit,
  canSalary,
  highlightItemId = null,
}: {
  supabase: SupabaseClient;
  partyId: string;
  params: Record<string, string | undefined>;
  today: string;
  tenantId: string;
  userId: string;
  earningsAll: boolean;
  accounts: readonly SettleAccount[];
  canCreate: boolean;
  canEdit: boolean;
  /** Maaş kategorisini görme (ofis sahibi + genel müdür); açık kalemler RPC'lerle aynı kuralla süzülür. */
  canSalary: boolean;
  /** `?kalem=<id>` ile gelinen elle girilmiş kalem: açık kalemler tablosunda vurgulanır. */
  highlightItemId?: string | null;
}) {
  const back = (
    <Link href={cariHref({}, {})} className="focus-ring inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Cariler
    </Link>
  );

  const { data: partyRaw, error: partyError } = await supabase.from("finance_parties").select(PARTY_COLUMNS).eq("id", partyId).maybeSingle();
  const party = (partyRaw as PartyRecord | null) ?? null;
  if (partyError || !party) {
    return (
      <div className="grid gap-4">
        {back}
        <EmptyState icon={Receipt} title="Kişi ya da firma bulunamadı" description="Kayıt silinmiş, arşivlenmiş ya da bu ofise ait değil." tone="amber" action={{ href: cariHref({}, {}), label: "Alacak ve borç listesine dön" }} />
      </div>
    );
  }
  // P12: başka danışmanın carisi (prim, bakiye, ekstre) earnings_all olmadan GÖRÜNMEZ; bağsız danışman carisi de kapalı.
  if (party.kind === "danisman" && !earningsAll && party.user_id !== userId) {
    return (
      <div className="grid gap-4">
        {back}
        <EmptyState icon={ShieldOff} title="Bu kişi/firmayı görme yetkiniz yok" description="Danışman carileri kazanç bilgisi içerir; her danışman yalnız kendi carisini görür." tone="amber" />
      </div>
    );
  }

  const kind = partyKindOf(party.kind);
  const from = isoDateParam(params.from);
  const to = isoDateParam(params.to);
  const filtered = Boolean(from || to);

  // Süzgeç yokken ekstre sınırsız okunur (p_from/p_to null): devir satırı oluşmaz ve ileri tarihli kalemler de girer;
  // böylece kapanış bakiyesi `finance_party_balances` bakiyesiyle (tarihten bağımsız açık kalemler) aynıdır.
  const [stmtRes, ownItems, balRes, owner, advisor, linkLabels] = await Promise.all([
    supabase.rpc("finance_party_statement", statementRpcArgs(party.id, from, to)),
    loadOpenItemRows(supabase, { partyId: party.id, canSalary }, new Set()),
    supabase.rpc("finance_party_balances", { p_kind: party.kind, p_q: party.name }),
    kind === "malik" ? loadOwnerStatement(supabase, { tenantId, partyId: party.id, customerId: party.customer_id }) : Promise.resolve(null),
    kind === "danisman" ? loadAdvisorEarnings(supabase, tenantId, party.user_id) : Promise.resolve(null),
    canEdit ? loadLinkLabels(supabase, party) : Promise.resolve(undefined),
  ]);

  // Malik: kira defterinden gelen "Mülk sahibine ödeme" satırları cariye değil kiraya bağlıdır (party_id boş);
  // malikin kiralarından üretilenler burada açık kalemlere ve KPI'lara katılır (Ödenecek ile aynı tutar).
  const ownerRentalIds = owner?.available ? owner.rentals.map((r) => r.rentalId) : [];
  const ownerPayouts = ownerRentalIds.length
    ? await loadOpenItemRows(supabase, { source: "owner_payout", sourceIds: ownerRentalIds, canSalary }, new Set())
    : null;
  const items = {
    error: ownItems.error || Boolean(ownerPayouts?.error),
    rows: [...ownItems.rows, ...(ownerPayouts?.rows ?? []).filter((r) => !ownItems.rows.some((o) => o.key === r.key))],
  };
  const hasOwnerPayouts = (ownerPayouts?.rows.length ?? 0) > 0;

  const lines: StatementLine[] = stmtRes.error ? [] : ((stmtRes.data ?? []) as Record<string, unknown>[]).map(normalizeStatementLine);
  const balRow = balRes.error ? null : ((balRes.data ?? []) as Record<string, unknown>[]).find((r) => r.party_id === party.id) ?? null;
  // Bakiye: süzgeçsiz ekstrenin kapanışı (tek kaynak); süzgeç varken liste RPC'sinin bakiyesi.
  const balance = !filtered && !stmtRes.error ? closingBalance(lines) : num(balRow?.balance);
  const aging = agingFromItems(items.rows.filter((r) => r.currency === "TRY"), today);
  const recvK = items.rows.filter((r) => r.direction === "receivable" && r.currency === "TRY").reduce((a, r) => a + toKurus(r.amount_open), 0);
  const payK = items.rows.filter((r) => r.direction === "payable" && r.currency === "TRY").reduce((a, r) => a + toKurus(r.amount_open), 0);

  const detailHref = (patch: Record<string, string>) => cariHref({ cari: party.id, from, to }, patch);
  const kpis: KpiItem[] = [
    { label: "Bakiye", value: formatAccountMoney(Math.abs(balance), "TRY"), icon: <Scale />, tone: toKurus(balance) > 0 ? "success" : toKurus(balance) < 0 ? "danger" : "neutral", href: `${detailHref({})}#ekstre`, hint: balanceCaption(balance) },
    { label: "Açık alacak", value: formatAccountMoney(fromKurus(recvK), "TRY"), icon: <ArrowDownLeft />, tone: "success", href: cariHref({}, { gorunum: "acik", yon: "alacak", kalem_cari: party.id }), hint: "tahsil edilecek" },
    { label: "Açık borç", value: formatAccountMoney(fromKurus(payK), "TRY"), icon: <ArrowUpRight />, tone: "warning", href: hasOwnerPayouts ? `${detailHref({})}#acik-kalemler` : cariHref({}, { gorunum: "acik", yon: "borc", kalem_cari: party.id }), hint: hasOwnerPayouts ? "ödenecek (malik alacağı dahil)" : "ödenecek" },
    {
      label: "Vadesi geçen",
      value: formatAccountMoney(aging.overdue, "TRY"),
      icon: <AlarmClock />,
      tone: aging.overdue > 0 ? "danger" : "neutral",
      attention: aging.overdue > 0,
      href: hasOwnerPayouts ? `${detailHref({})}#acik-kalemler` : cariHref({}, { gorunum: "acik", kova: "gecikmis", kalem_cari: party.id }),
      hint: `${aging.overdueCount} kalem`,
    },
  ];

  return (
    <div className="grid gap-5">
      {back}

      <header className="surface-card grid gap-3 rounded-[var(--radius-panel)] p-4 sm:p-5 md:grid-cols-[1fr_auto] md:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words font-display text-xl font-bold text-text sm:text-2xl">{party.name}</h2>
            <StatusPill tone="info" dot={false}>{partyKindLabel(party.kind)}</StatusPill>
            {party.archived_at ? <StatusPill tone="neutral" dot={false}>Arşivde</StatusPill> : null}
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
            {party.phone ? (
              <a href={`tel:${party.phone}`} className="inline-flex min-h-9 touch:min-h-11 items-center gap-1 hover:text-text"><Phone className="h-3.5 w-3.5" aria-hidden="true" />{formatPhoneDisplay(party.phone)}</a>
            ) : null}
            {party.email ? (
              <a href={`mailto:${party.email}`} className="inline-flex min-h-9 touch:min-h-11 items-center gap-1 break-all hover:text-text"><Mail className="h-3.5 w-3.5" aria-hidden="true" />{party.email}</a>
            ) : null}
            {party.tax_id ? <span>VKN <span className="numeric">{party.tax_id}</span></span> : null}
            {party.customer_id ? <Link href={`/app/musteriler/${party.customer_id}`} className="font-semibold text-accent-text hover:underline">Müşteri kaydı</Link> : null}
          </p>
          {party.note ? <p className="mt-2 max-w-prose whitespace-pre-line text-sm text-text-muted">{party.note}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {canCreate ? <NewOpenItemButton party={{ id: party.id, name: party.name, kind }} today={today} defaultDirection={kind === "tedarikci" || kind === "malik" ? "payable" : "receivable"} /> : null}
          {canEdit ? <PartyFormButton party={party} variant="outline" canLink linkLabels={linkLabels} /> : null}
        </div>
      </header>

      <KpiStrip items={kpis} label="Alacak / borç bakiyesi" />

      {owner ? <OwnerSection owner={owner} partyId={party.id} /> : null}
      {advisor ? <AdvisorSection advisor={advisor} self={party.user_id === userId} /> : null}

      <section id="acik-kalemler" aria-labelledby="cari-acik" className="grid scroll-mt-24 gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="cari-acik" className="font-display text-base font-bold text-text">Açık kalemler</h3>
          {items.rows.length > 0 ? (
            <Link href={cariHref({}, { gorunum: "acik", kalem_cari: party.id })} className="text-xs font-semibold text-accent-text hover:underline">Yaşlandırmayla gör</Link>
          ) : null}
        </div>
        {items.error ? (
          <p role="alert" className="text-sm text-text-muted">Açık kalemler okunamadı.</p>
        ) : items.rows.length === 0 ? (
          <p className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-text-muted">
            Açık alacak ya da borç yok.{canCreate ? " Vadeli bir kalem için 'Yeni alacak / borç' kullanın." : ""}
          </p>
        ) : (
          <OpenItemsTable rows={items.rows} today={today} accounts={accounts} canSettle={canCreate} showParty={false} highlightKey={highlightItemId ? `manual:${highlightItemId}` : null} />
        )}
      </section>

      <section id="ekstre" aria-labelledby="cari-ekstre" className="grid scroll-mt-24 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="cari-ekstre" className="font-display text-base font-bold text-text">Hesap dökümü</h3>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={financeHref("hareketler", { cari: party.id })} className="focus-ring inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 text-xs font-semibold text-accent-text hover:underline">
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" /> Hareketlerde gör
            </Link>
          </div>
        </div>
        <form method="get" action={financePartyHref(party.id)} className="flex flex-wrap items-end gap-2" aria-label="Ekstre tarih aralığı">
          <FilterDate name="from" label="Başlangıç" value={from} />
          <FilterDate name="to" label="Bitiş" value={to} />
          <Button type="submit" variant="outline" size="sm" className="h-9">Uygula</Button>
          {filtered ? <Link href={cariHref({}, { cari: party.id })} className="min-h-9 touch:min-h-11 px-2 text-xs font-semibold leading-9 text-accent-text hover:underline">Tümü</Link> : null}
        </form>
        {stmtRes.error ? (
          <p role="alert" className="text-sm text-text-muted">Ekstre okunamadı.</p>
        ) : lines.length === 0 ? (
          <p className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-text-muted">Bu aralıkta kayıt yok.</p>
        ) : (
          <StatementTable lines={lines} />
        )}
      </section>
    </div>
  );
}

function StatementTable({ lines }: { lines: readonly StatementLine[] }) {
  const last = closingBalance(lines);
  return (
    <>
      <MobileCardList aria-label="Hesap dökümü">
        {lines.map((l, i) => (
          <MobileCard key={`${l.ref_id ?? "x"}-${i}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <LineTitle line={l} />
                <p className="numeric mt-0.5 text-xs text-text-muted">{formatDateTr(l.d)} · {statementDocLabel(l.doc_type)}</p>
              </div>
              <span className="shrink-0 text-right">
                {l.debit > 0 ? <span className="numeric block font-bold text-success-strong">+{formatAccountMoney(l.debit, "TRY")}</span> : null}
                {l.credit > 0 ? <span className="numeric block font-bold text-danger-strong">−{formatAccountMoney(l.credit, "TRY")}</span> : null}
                <span className="numeric block text-xs text-text-faint">Bakiye {formatAccountMoney(l.running_balance, "TRY")}</span>
              </span>
            </div>
          </MobileCard>
        ))}
      </MobileCardList>
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-line-strong bg-surface px-4 py-3 md:hidden">
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">Kapanış bakiyesi</span>
        <BalanceCell balance={last} />
      </div>
      <div className="hidden overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface md:block">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Hesap dökümü (borç bize borçlandıran, alacak kapatan kayıttır)</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">
              <th scope="col" className="px-4 py-2.5">Tarih</th>
              <th scope="col" className="px-4 py-2.5">Kayıt</th>
              <th scope="col" className="px-4 py-2.5 text-right">Borç</th>
              <th scope="col" className="px-4 py-2.5 text-right">Alacak</th>
              <th scope="col" className="px-4 py-2.5 text-right">Bakiye</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.ref_id ?? "x"}-${i}`} className="border-b border-line last:border-b-0 hover:bg-surface-hover/40">
                <td className="numeric whitespace-nowrap px-4 py-2.5 text-text-muted">{formatDateTr(l.d)}</td>
                <td className="px-4 py-2.5">
                  <LineTitle line={l} />
                  <p className="text-xs text-text-faint">{statementDocLabel(l.doc_type)}</p>
                </td>
                <td className="numeric whitespace-nowrap px-4 py-2.5 text-right">{l.debit > 0 ? formatAccountMoney(l.debit, "TRY") : <span className="text-text-faint">—</span>}</td>
                <td className="numeric whitespace-nowrap px-4 py-2.5 text-right">{l.credit > 0 ? formatAccountMoney(l.credit, "TRY") : <span className="text-text-faint">—</span>}</td>
                <td className="numeric whitespace-nowrap px-4 py-2.5 text-right font-semibold text-text">{formatAccountMoney(l.running_balance, "TRY")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong">
              <th scope="row" colSpan={4} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">Kapanış bakiyesi</th>
              <td className="px-4 py-3"><BalanceCell balance={last} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function LineTitle({ line }: { line: StatementLine }) {
  const text = line.title || statementDocLabel(line.doc_type);
  return line.href ? (
    <Link href={line.href} className="break-words font-semibold text-text hover:text-accent-text hover:underline">{text}</Link>
  ) : (
    <p className="break-words font-semibold text-text">{text}</p>
  );
}

function OwnerSection({ owner, partyId }: { owner: OwnerStatement; partyId: string }) {
  if (!owner.available) {
    return (
      <p className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface px-4 py-3 text-xs text-text-muted">
        {owner.reason === "no_customer"
          ? "Malik alacağı için bu kişi/firmayı bir müşteri kaydına bağlayın (portföyün mülk sahibi olarak seçili müşteri)."
          : "Mülk yönetimi verisi okunamadı."}
      </p>
    );
  }
  const t = owner.totals;
  const lines: { label: string; value: number; sign: "+" | "−" | "="; href?: string }[] = [
    { label: "Tahsil edilen kira", value: t.collected, sign: "+", href: "/app/kiralama?yonetim=ucret" },
    { label: "Yönetim ücreti", value: t.fee, sign: "−", href: "/app/kiralama?yonetim=ucret" },
    { label: "Masraf ve aidat", value: t.charges, sign: "−" },
    { label: "Malik alacağı", value: t.entitlement, sign: "=" },
    { label: "Ödenen", value: t.paidOut, sign: "−", href: financeHref("hareketler", { kategori: "mulk_sahibi_odeme", cari: partyId }) },
  ];
  return (
    <section aria-labelledby="cari-malik" className="surface-card grid gap-3 rounded-[var(--radius-panel)] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="cari-malik" className="font-display text-base font-bold text-text">Malik alacağı</h3>
        <span className="text-xs text-text-faint">Mülk yönetimi defterinden okunur; burada değiştirilmez.</span>
      </div>
      <dl className="grid gap-1 text-sm">
        {lines.map((l) => (
          <div key={l.label} className={`flex items-center justify-between gap-3 ${l.sign === "=" ? "border-t border-line pt-1.5 font-semibold" : ""}`}>
            <dt className="text-text-muted">
              <span className="numeric mr-1.5 inline-block w-3 text-text-faint" aria-hidden="true">{l.sign}</span>
              {l.href ? <Link href={l.href} className="hover:text-text hover:underline">{l.label}</Link> : l.label}
            </dt>
            <dd className="numeric text-text">{formatAccountMoney(l.value, "TRY")}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-line-strong pt-2">
          <dt className="font-display font-bold text-text">Ödenecek</dt>
          <dd className="numeric font-display text-lg font-bold text-danger-strong">{formatAccountMoney(t.payable, "TRY")}</dd>
        </div>
      </dl>
      {t.withholding > 0 ? (
        <p className="text-xs text-text-muted">
          Bilgi: bu cariye bağlı hareketlerde{" "}
          <Link href={financeHref("hareketler", { cari: partyId })} className="font-semibold text-accent-text hover:underline">
            {formatAccountMoney(t.withholding, "TRY")} stopaj
          </Link>{" "}
          var. Malik alacağından düşülmez; kira tahsilatı kira defterine hangi tutarla girildiyse o esastır (Açık kalemlerdeki &quot;Mülk sahibine ödeme&quot; ile aynı formül).
        </p>
      ) : null}
      {owner.truncated ? (
        <p role="status" className="text-xs text-warning-strong">
          Kayıt sayısı üst sınıra ulaştı: her defterden ilk {OWNER_STATEMENT_MAX_ROWS.toLocaleString("tr-TR")} kayıt hesaba katıldı; toplamlar eksik olabilir.
        </p>
      ) : null}
      {t.overpaid > 0 ? <p className="text-xs text-warning-strong">Fazla ödeme: {formatAccountMoney(t.overpaid, "TRY")} (malikten alacak).</p> : null}
      {owner.rentals.length > 0 ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 border-t border-line pt-2 text-xs">
          {owner.rentals.map((r) => (
            <li key={r.rentalId}>
              <Link href={`/app/kiralama/${r.rentalId}`} className="focus-ring flex min-h-9 touch:min-h-11 items-center justify-between gap-3 rounded-[var(--radius-control)] px-1 hover:bg-surface-hover">
                <span className="min-w-0 truncate text-text">{r.propertyLabel}</span>
                <span className="numeric shrink-0 text-text-muted">{formatAccountMoney(r.balance, "TRY")}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-text-muted">Bu malike ait yönetilen kira yok.</p>
      )}
    </section>
  );
}

function AdvisorSection({ advisor, self }: { advisor: AdvisorEarnings; self: boolean }) {
  if (!advisor.available) {
    return <p className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface px-4 py-3 text-xs text-text-muted">Danışman bir kullanıcıya bağlı değil ya da prim bilgisi okunamadı.</p>;
  }
  const items = [
    { label: "Kazanılan prim", value: advisor.earned, hint: `${advisor.count} komisyon payı` },
    { label: "Ödenen", value: advisor.paid, hint: "ödenmiş komisyonlar" },
    { label: "Bekleyen", value: advisor.pending, hint: "henüz ödenmedi" },
  ];
  return (
    <section aria-labelledby="cari-danisman" className="surface-card grid gap-3 rounded-[var(--radius-panel)] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="cari-danisman" className="font-display text-base font-bold text-text">{self ? "Kazandığım prim" : "Kazanılan prim"}</h3>
        <span className="text-xs text-text-faint">Komisyon paylarından okunur; kazanç gizliliği korunur.</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {items.map((it) => (
          <li key={it.label}>
            <Link href={self ? earningsPath() : financePath("komisyon")} className="focus-ring press block rounded-[var(--radius-control)] border border-line bg-surface p-3 transition hover:border-brand-300">
              <span className="block text-xs text-text-muted">{it.label}</span>
              <span className="numeric mt-0.5 block font-display text-lg font-bold text-text">{formatAccountMoney(it.value, "TRY")}</span>
              <span className="block text-xs text-text-faint">{it.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
      {advisor.truncated ? (
        <p role="status" className="text-xs text-warning-strong">
          Kayıt sayısı üst sınıra ulaştı: ilk {ADVISOR_SPLITS_MAX_ROWS.toLocaleString("tr-TR")} komisyon payı gösteriliyor; toplamlar eksik olabilir.
        </p>
      ) : null}
    </section>
  );
}
