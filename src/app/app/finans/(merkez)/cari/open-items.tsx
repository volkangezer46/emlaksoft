import Link from "@/components/ui/smart-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowRight, ListChecks } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { MobileCard, MobileCardList, StatusPill } from "@/components/ui/list-kit";
import { formatDateTr } from "@/lib/format";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import {
  AGING_LABEL,
  agingBucketKeyOf,
  agingBucketOf,
  agingFromItems,
  bucketDueRange,
  isOverdueBucket,
  daysPastDue,
  dedupeOpenItems,
  fromKurus,
  num,
  OPEN_ITEM_SOURCE_LABEL,
  OPEN_ITEM_SOURCES,
  openItemSourceOf,
  safeHref,
  statusAfter,
  toKurus,
  type AgingBucketKey,
  type OpenItemSource,
} from "@/lib/finance/party/aging";
import type { ParamRecord } from "@/lib/ui/filter-params";
import { AgingBars } from "./aging-bars";
import { cariHref, isHiddenParty } from "./party-list";
import { SettleButton, type SettleAccount } from "./settle-dialog";

/**
 * Açık kalemler (?sekme=cari&gorunum=acik): `finance_open_items_v` tek kaynaktır — elle girilen alacak/borç, ödenmemiş kira
 * tahakkuku, hesaplanmış komisyon, düzenli ödeme ve mülk sahibine ödenecek tutar. Veri kopyalanmaz; kaynak satırı tıklanınca
 * kendi sayfasına gider, yalnız elle girilen kalem burada "Tahsil et / Öde" ile kapatılır.
 *
 * Yaşlandırma çubukları AYNI satırlardan (`agingFromItems`, TRY) hesaplanır: kova toplamı = açık kalem toplamı ve her kova
 * tıklanınca liste aynı sınırlarla (`bucketDueRange`) süzülür. Filtreler URL'de: yon (alacak|borc), kova, kaynak, kalem_cari.
 */

export const OPEN_ITEMS_CAP = 2000;

export type OpenItemRow = {
  key: string;
  source: OpenItemSource;
  source_id: string | null;
  direction: "receivable" | "payable";
  party_id: string | null;
  party_label: string;
  category: string | null;
  title: string;
  amount_open: number;
  currency: string;
  due_date: string | null;
  href: string | null;
  /** Yalnız elle girilen kalem: brüt tutar, ödenen ve durum (Kısmi rozeti için). */
  manual: { amount: number; paid: number; status: "open" | "partial" | "paid"; source_type: string | null; source_id: string | null } | null;
};

export type OpenItemsFilter = {
  direction?: "receivable" | "payable" | null;
  partyId?: string | null;
  source?: OpenItemSource | null;
  /** Yalnız bu kaynak kimlikleri (ör. malik detayında kiraların `owner_payout` satırları; boş dizi = satır yok). */
  sourceIds?: readonly string[] | null;
  /** Maaş kategorisini göster (yalnız ofis sahibi + genel müdür). false iken `maas` satırları sorguda düşer. */
  canSalary: boolean;
};

/**
 * Görünümü okur, elle girilen kalemleri zenginleştirir, tekilleştirir ve gizli carileri (P12) düşer.
 * Maaş kuralı RPC'lerle (finance_aging / finance_party_balances / finance_party_statement) aynıdır: `maas` kategorisi
 * yalnız `canSalary` iken okunur (kategorisiz satırlar her zaman kalır).
 */
export async function loadOpenItemRows(
  supabase: SupabaseClient,
  filter: OpenItemsFilter,
  hidden: ReadonlySet<string>,
): Promise<{ rows: OpenItemRow[]; error: boolean; capped: boolean }> {
  let q = supabase
    .from("finance_open_items_v")
    .select("key, source, source_id, direction, party_id, party_label, title, category, amount_open, currency, due_date, href")
    .gt("amount_open", 0);
  if (!filter.canSalary) q = q.or("category.is.null,category.neq.maas");
  if (filter.direction) q = q.eq("direction", filter.direction);
  if (filter.partyId) q = q.eq("party_id", filter.partyId);
  if (filter.source) q = q.eq("source", filter.source);
  if (filter.sourceIds) {
    if (filter.sourceIds.length === 0) return { rows: [], error: false, capped: false };
    q = q.in("source_id", filter.sourceIds.slice(0, 500));
  }
  const { data, error } = await q.order("due_date", { ascending: true, nullsFirst: false }).limit(OPEN_ITEMS_CAP);
  if (error) return { rows: [], error: true, capped: false };

  const raw = ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({
      key: String(r.key ?? ""),
      source: openItemSourceOf(r.source),
      source_id: typeof r.source_id === "string" ? r.source_id : null,
      direction: r.direction === "payable" ? ("payable" as const) : ("receivable" as const),
      party_id: typeof r.party_id === "string" ? r.party_id : null,
      party_label: String(r.party_label ?? ""),
      category: typeof r.category === "string" ? r.category : null,
      title: String(r.title ?? ""),
      amount_open: num(r.amount_open),
      currency: String(r.currency ?? "TRY") || "TRY",
      due_date: typeof r.due_date === "string" ? r.due_date.slice(0, 10) : null,
      href: safeHref(r.href),
    }))
    // İkinci savunma hattı: sorgu süzgeci atlanırsa bile maaş satırı yetkisiz kullanıcıya düşmez.
    .filter((r) => filter.canSalary || r.category !== "maas")
    .filter((r): r is Omit<OpenItemRow, "manual"> & { source: OpenItemSource } => Boolean(r.key && r.source));

  const manualIds = raw.filter((r) => r.source === "manual" && r.source_id).map((r) => r.source_id as string);
  const manualInfo = new Map<string, OpenItemRow["manual"]>();
  for (let i = 0; i < manualIds.length; i += 200) {
    const part = manualIds.slice(i, i + 200);
    const res = await supabase.from("finance_open_items").select("id, amount, paid_amount, status, source_type, source_id").in("id", part);
    if (res.error) break;
    for (const m of (res.data ?? []) as Record<string, unknown>[]) {
      manualInfo.set(String(m.id), {
        amount: num(m.amount),
        paid: num(m.paid_amount),
        status: statusAfter(m.amount, m.paid_amount),
        source_type: typeof m.source_type === "string" ? m.source_type : null,
        source_id: typeof m.source_id === "string" ? m.source_id : null,
      });
    }
  }

  const enriched = raw.map((r) => {
    const manual = r.source === "manual" && r.source_id ? (manualInfo.get(r.source_id) ?? null) : null;
    return { ...r, manual, manual_source: manual ? { type: manual.source_type, id: manual.source_id } : null };
  });
  // P12: gizli danışman carileri düşer. Danışman listesi okunamadıysa ("*danisman") hangi carinin danışman olduğu
  // bilinmez → cariye bağlı tüm satırlar gizlenir (güvenli taraf; carisiz kaynak satırları kalır).
  const unknownAdvisors = hidden.has("*danisman");
  const rows = dedupeOpenItems(enriched)
    .filter((r) => !r.party_id || (!unknownAdvisors && !isHiddenParty(hidden, r.party_id, null)))
    .map(({ manual_source: _drop, ...r }) => {
      void _drop;
      return r;
    });
  return { rows, error: false, capped: (data ?? []).length >= OPEN_ITEMS_CAP };
}

/** Kova filtresi (gecikmis = vadesi geçen tüm kovalar). */
export function inBucket(row: Pick<OpenItemRow, "due_date">, bucket: AgingBucketKey | "gecikmis", today: string): boolean {
  if (bucket === "gecikmis") return isOverdueBucket(agingBucketOf(row.due_date, today));
  const r = bucketDueRange(bucket, today);
  if (!row.due_date || r.nullOnly) return !row.due_date && r.nullOnly;
  return (r.dueFrom === null || row.due_date >= r.dueFrom) && (r.dueTo === null || row.due_date <= r.dueTo);
}

const DIR_PARAM: Record<string, "receivable" | "payable"> = { alacak: "receivable", borc: "payable" };

/** Açık kalemler görünümü: yaşlandırma çubukları + süzülebilir liste. */
export async function OpenItemsView({
  supabase,
  params,
  today,
  hidden,
  accounts,
  canSettle,
  canSalary,
  partyName,
  highlightKey = null,
}: {
  supabase: SupabaseClient;
  params: ParamRecord;
  today: string;
  hidden: ReadonlySet<string>;
  accounts: readonly SettleAccount[];
  canSettle: boolean;
  canSalary: boolean;
  partyName: string | null;
  /** `?kalem=<id>` ile gelinen elle girilmiş kalem (`manual:<id>`): satır vurgulanır ve görünür alana kaydırılır. */
  highlightKey?: string | null;
}) {
  const yon = typeof params.yon === "string" && params.yon in DIR_PARAM ? params.yon : "";
  const direction = yon ? DIR_PARAM[yon] : null;
  const kovaRaw = typeof params.kova === "string" ? params.kova : "";
  const kova: AgingBucketKey | "gecikmis" | null = kovaRaw === "gecikmis" ? "gecikmis" : agingBucketKeyOf(kovaRaw);
  const source = openItemSourceOf(params.kaynak);
  const partyId = typeof params.kalem_cari === "string" && /^[0-9a-f-]{36}$/i.test(params.kalem_cari) ? params.kalem_cari : null;

  // Tek okuma: yön süzgeci yok → iki yönün çubukları da aynı satırlardan çizilir.
  const { rows: all, error, capped } = await loadOpenItemRows(supabase, { partyId, source, canSalary }, hidden);
  const tryRows = all.filter((r) => r.currency === "TRY");
  const recvAging = agingFromItems(tryRows.filter((r) => r.direction === "receivable"), today);
  const payAging = agingFromItems(tryRows.filter((r) => r.direction === "payable"), today);
  const foreignCount = all.length - tryRows.length;

  const rows = all.filter((r) => (!direction || r.direction === direction) && (!kova || inBucket(r, kova, today)));
  const listTotalK = rows.filter((r) => r.currency === "TRY").reduce((a, r) => a + toKurus(r.amount_open), 0);

  const base: ParamRecord = { gorunum: "acik", yon: yon || "", kova: kova ?? "", kaynak: source ?? "", kalem_cari: partyId ?? "" };
  const bucketHref = (dir: "alacak" | "borc") => (b: AgingBucketKey) => cariHref(base, { yon: dir, kova: b });

  return (
    <div className="grid gap-4">
      <div className={`grid gap-3 ${direction ? "" : "lg:grid-cols-2"}`}>
        {direction !== "payable" ? (
          <AgingBars title="Alacak yaşlandırma" summary={recvAging} hrefFor={bucketHref("alacak")} activeBucket={yon === "alacak" ? kova : null} totalHref={cariHref(base, { yon: "alacak", kova: "" })} />
        ) : null}
        {direction !== "receivable" ? (
          <AgingBars title="Borç yaşlandırma" summary={payAging} hrefFor={bucketHref("borc")} activeBucket={yon === "borc" ? kova : null} totalHref={cariHref(base, { yon: "borc", kova: "" })} />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Açık kalem süzgeçleri">
        <FilterChip href={cariHref(base, { yon: "" })} active={!yon}>Tümü</FilterChip>
        <FilterChip href={cariHref(base, { yon: "alacak" })} active={yon === "alacak"}>Alacaklar</FilterChip>
        <FilterChip href={cariHref(base, { yon: "borc" })} active={yon === "borc"}>Borçlar</FilterChip>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        {OPEN_ITEM_SOURCES.map((s) => (
          <FilterChip key={s} href={cariHref(base, { kaynak: source === s ? "" : s })} active={source === s}>
            {OPEN_ITEM_SOURCE_LABEL[s]}
          </FilterChip>
        ))}
        {kova ? (
          <FilterChip href={cariHref(base, { kova: "" })} active tone="danger" aria-label="Vade kovası süzgecini kaldır">
            {kova === "gecikmis" ? "Vadesi geçen" : AGING_LABEL[kova]} ✕
          </FilterChip>
        ) : null}
        {partyId ? (
          <FilterChip href={cariHref(base, { kalem_cari: "" })} active aria-label="Kişi süzgecini kaldır">
            {partyName ?? "Seçili kişi/firma"} ✕
          </FilterChip>
        ) : null}
      </div>

      <p className="text-xs text-text-muted" aria-live="polite">
        <span className="numeric font-semibold text-text">{rows.length}</span> kalem · toplam{" "}
        <span className="numeric font-semibold text-text">{formatAccountMoney(fromKurus(listTotalK), "TRY")}</span>
        {foreignCount > 0 ? <> · {foreignCount} döviz kalemi toplamlara katılmadı</> : null}
      </p>
      {capped ? (
        <p role="status" className="tone-warning rounded-[var(--radius-control)] px-3 py-2 text-xs">
          Toplamlar eksik: yalnız ilk {OPEN_ITEMS_CAP} kalem okundu; çubuklar ve toplam bu kalemlerden hesaplandı. Süzgeç
          ekleyerek (yön, kaynak, cari) listeyi daraltın.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 text-sm text-text-muted">
          Açık kalemler okunamadı. Sayfayı yenileyin; sorun sürerse veritabanı güncellemesinin uygulandığından emin olun.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={kova || yon || source || partyId ? "Bu süzgeçle açık kalem yok" : "Açık kalem yok"}
          description="Vadesi gelen alacaklar, ödenmemiş kiralar, hesaplanmış komisyonlar ve yaklaşan ödemeler burada toplanır."
          tone="amber"
          action={kova || yon || source || partyId ? { href: cariHref({}, { gorunum: "acik" }), label: "Süzgeçleri temizle" } : undefined}
        />
      ) : (
        <OpenItemsTable rows={rows} today={today} accounts={accounts} canSettle={canSettle} showParty highlightKey={highlightKey} />
      )}
    </div>
  );
}

/** `?kalem=` ile açılan kalemin bağlantı çapası (cari detayı ve açık kalemler; `#kalem` ile kaydırılır). */
export const HIGHLIGHT_ANCHOR = "kalem";
const HIGHLIGHT_CLASS = "bg-surface-accent-soft ring-2 ring-inset ring-brand-300";

/** Açık kalem tablosu (masaüstü) ve kartları (mobil); cari detayında da kullanılır. */
export function OpenItemsTable({
  rows,
  today,
  accounts,
  canSettle,
  showParty,
  highlightKey = null,
}: {
  rows: readonly OpenItemRow[];
  today: string;
  accounts: readonly SettleAccount[];
  canSettle: boolean;
  showParty: boolean;
  highlightKey?: string | null;
}) {
  return (
    <>
      <MobileCardList aria-label="Açık kalemler">
        {rows.map((r) => (
          <MobileCard key={r.key} id={r.key === highlightKey ? `${HIGHLIGHT_ANCHOR}-m` : undefined} className={r.key === highlightKey ? HIGHLIGHT_CLASS : undefined}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <ItemTitle row={r} />
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                  {showParty ? <PartyLink row={r} /> : null}
                  <DueText row={r} today={today} />
                </p>
              </div>
              <Amount row={r} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
              <span className="flex flex-wrap gap-1.5">
                <StatusPill tone="info" dot={false}>{OPEN_ITEM_SOURCE_LABEL[r.source]}</StatusPill>
                <StatePill row={r} />
              </span>
              <RowAction row={r} today={today} accounts={accounts} canSettle={canSettle} />
            </div>
          </MobileCard>
        ))}
      </MobileCardList>
      <div className="hidden overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface md:block">
        <table className="w-full min-w-[820px] text-sm">
          <caption className="sr-only">Açık kalemler</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">
              <th scope="col" className="px-4 py-2.5">Vade</th>
              <th scope="col" className="px-4 py-2.5">Kalem</th>
              {showParty ? <th scope="col" className="px-4 py-2.5">Kişi / firma</th> : null}
              <th scope="col" className="px-4 py-2.5">Durum</th>
              <th scope="col" className="px-4 py-2.5 text-right">Kalan</th>
              <th scope="col" className="px-4 py-2.5 text-right"><span className="sr-only">İşlem</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                id={r.key === highlightKey ? HIGHLIGHT_ANCHOR : undefined}
                aria-current={r.key === highlightKey ? "true" : undefined}
                className={`border-b border-line last:border-b-0 hover:bg-surface-hover/40 ${r.key === highlightKey ? HIGHLIGHT_CLASS : ""}`}
              >
                <td className="whitespace-nowrap px-4 py-3"><DueText row={r} today={today} /></td>
                <td className="px-4 py-3">
                  <ItemTitle row={r} />
                  <StatusPill tone="info" dot={false} className="mt-1">{OPEN_ITEM_SOURCE_LABEL[r.source]}</StatusPill>
                </td>
                {showParty ? <td className="px-4 py-3"><PartyLink row={r} /></td> : null}
                <td className="px-4 py-3"><StatePill row={r} /></td>
                <td className="px-4 py-3 text-right"><Amount row={r} /></td>
                <td className="px-4 py-3 text-right"><RowAction row={r} today={today} accounts={accounts} canSettle={canSettle} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ItemTitle({ row }: { row: OpenItemRow }) {
  return row.href ? (
    <Link href={row.href} className="break-words font-semibold text-text hover:text-accent-text hover:underline">{row.title || OPEN_ITEM_SOURCE_LABEL[row.source]}</Link>
  ) : (
    <p className="break-words font-semibold text-text">{row.title || OPEN_ITEM_SOURCE_LABEL[row.source]}</p>
  );
}

function PartyLink({ row }: { row: OpenItemRow }) {
  if (row.party_id) return <Link href={cariHref({}, { cari: row.party_id })} className="font-medium text-accent-text hover:underline">{row.party_label || "Kişi / firma"}</Link>;
  return <span>{row.party_label || "—"}</span>;
}

function DueText({ row, today }: { row: OpenItemRow; today: string }) {
  if (!row.due_date) return <span className="text-text-faint">Vadesiz</span>;
  const late = daysPastDue(row.due_date, today);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="numeric text-text-muted">{formatDateTr(row.due_date)}</span>
      {late > 0 ? <StatusPill tone={late > 60 ? "danger" : "warning"} dot={false}>{late} gün gecikti</StatusPill> : late === 0 ? <StatusPill tone="info" dot={false}>Bugün</StatusPill> : null}
    </span>
  );
}

function StatePill({ row }: { row: OpenItemRow }) {
  if (row.manual?.status === "partial") {
    return <StatusPill tone="warning" title={`Ödenen ${formatAccountMoney(row.manual.paid, row.currency)} / ${formatAccountMoney(row.manual.amount, row.currency)}`}>Kısmi</StatusPill>;
  }
  return <StatusPill tone="neutral">Açık</StatusPill>;
}

function Amount({ row }: { row: OpenItemRow }) {
  const cls = row.direction === "receivable" ? "text-success-strong" : "text-danger-strong";
  return (
    <span className="block shrink-0 text-right">
      <span className={`numeric font-bold ${cls}`}>{formatAccountMoney(row.amount_open, row.currency)}</span>
      {row.manual && row.manual.paid > 0 ? (
        <span className="numeric block text-xs text-text-faint">/ {formatAccountMoney(row.manual.amount, row.currency)}</span>
      ) : null}
    </span>
  );
}

function RowAction({ row, today, accounts, canSettle }: { row: OpenItemRow; today: string; accounts: readonly SettleAccount[]; canSettle: boolean }) {
  if (row.source === "manual" && row.source_id && canSettle) {
    // Kalan = görünümün açık tutarı (tek kaynak); brüt tutar yalnız "Kısmi/Kapandı" önizlemesi içindir.
    const amount = row.manual?.amount ?? row.amount_open;
    return (
      <SettleButton
        item={{ id: row.source_id, title: row.title, direction: row.direction, amount, remaining: row.amount_open, currency: row.currency }}
        accounts={accounts}
        today={today}
      />
    );
  }
  if (row.href && row.source !== "manual") {
    return (
      <Link href={row.href} className="focus-ring inline-flex min-h-9 touch:min-h-11 items-center gap-1 text-xs font-semibold text-accent-text hover:underline">
        Kaynağa git <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    );
  }
  return null;
}
