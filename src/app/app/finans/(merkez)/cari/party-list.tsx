import Link from "@/components/ui/smart-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlarmClock, ArrowDownLeft, ArrowUpRight, Users } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { KpiStrip, ListPager, ListToolbar, MobileCard, MobileCardList, StatusPill, type KpiItem } from "@/components/ui/list-kit";
import { pageWindow, parsePage } from "@/components/ui/list-kit/list-logic";
import { formatDateTr } from "@/lib/format";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { balanceCaption, fromKurus, num, PARTY_KIND_LABEL, PARTY_KINDS, partyKindLabel, partyKindOf, toKurus, type PartyKindKey } from "@/lib/finance/party/aging";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { buildHref, mergeParams, type ParamRecord } from "@/lib/ui/filter-params";
import { financePartyHref, financePath } from "@/lib/finance/routes";

export const PARTY_PAGE_SIZE = 50;

/**
 * Cari adresleri (TEK yer): `cari=<id>` verilirse cari detayı yoludur (`/app/finans/cari/<id>`), yoksa liste/açık kalemler
 * (`/app/finans/cari?…`). Boş değerler ve sayfa numarası yazılmaz.
 */
export function cariHref(params: ParamRecord, patch: ParamRecord): string {
  const sp = mergeParams(params, { sayfa: "", ...patch });
  const partyId = sp.get("cari");
  sp.delete("cari");
  return buildHref(partyId ? financePartyHref(partyId) : financePath("cari"), sp);
}

export type PartyBalanceRow = {
  party_id: string;
  name: string;
  kind: PartyKindKey | null;
  receivable_open: number;
  payable_open: number;
  paid_in: number;
  paid_out: number;
  balance: number;
  overdue_amount: number;
  last_activity: string | null;
};

export function normalizeBalanceRow(r: Record<string, unknown>): PartyBalanceRow {
  return {
    party_id: String(r.party_id ?? ""),
    name: String(r.name ?? ""),
    kind: partyKindOf(r.kind),
    receivable_open: num(r.receivable_open),
    payable_open: num(r.payable_open),
    paid_in: num(r.paid_in),
    paid_out: num(r.paid_out),
    balance: num(r.balance),
    overdue_amount: num(r.overdue_amount),
    last_activity: typeof r.last_activity === "string" ? r.last_activity.slice(0, 10) : null,
  };
}

/** Danışman carisi gizlilik listesinin açık üst sınırı (satır). */
const HIDDEN_PARTY_MAX_ROWS = 20_000;

/**
 * P12 kazanç gizliliği: `earnings_all` izni olmayan kullanıcı başka danışmanın carisini (bakiye, ekstre, prim) GÖRMEZ.
 * Dönen küme gizlenecek cari kimlikleridir: türü danışman olup kullanıcıya bağlı olmayanlar (bağsız danışman carisi de
 * gizlenir: kime ait olduğu bilinmiyor). İzin varsa boş küme.
 */
export async function loadHiddenPartyIds(supabase: SupabaseClient, input: { userId: string; earningsAll: boolean }): Promise<Set<string>> {
  if (input.earningsAll) return new Set();
  const { rows, error, truncated } = await readAllPaged<{ id: string; user_id: string | null }>(
    (from, to) => supabase.from("finance_parties").select("id, user_id").eq("kind", "danisman").order("id").range(from, to),
    { maxRows: HIDDEN_PARTY_MAX_ROWS },
  );
  // Okunamıyorsa ya da liste üst sınıra takıldıysa (tam değil) güvenli taraf: hiçbir danışman carisi kesin bilinmiyor →
  // liste RPC'sinden gelen danışman türü süzülür (aşağıda). Kesik listeyle gizlilik sessizce delinmez.
  if (error || truncated) return new Set(["*danisman"]);
  return new Set(rows.filter((p) => p.user_id !== input.userId).map((p) => p.id));
}

export function isHiddenParty(hidden: ReadonlySet<string>, id: string, kind: string | null): boolean {
  return hidden.has(id) || (kind === "danisman" && hidden.has("*danisman"));
}

/** Cari listesi: tür çipleri, arama, bakiye KPI'ları, masaüstünde tablo, mobilde kart. */
export async function PartyList({
  supabase,
  params,
  hidden,
}: {
  supabase: SupabaseClient;
  params: ParamRecord;
  hidden: ReadonlySet<string>;
}) {
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 60);
  const kind = partyKindOf(params.tur);
  const sign = params.bakiye === "alacak" || params.bakiye === "borc" ? params.bakiye : null;
  const page = parsePage(params.sayfa);

  const { data, error } = await supabase.rpc("finance_party_balances", { p_kind: null, p_q: q || null });
  const all = error ? [] : ((data ?? []) as Record<string, unknown>[]).map(normalizeBalanceRow).filter((r) => r.party_id && !isHiddenParty(hidden, r.party_id, r.kind));

  const counts = new Map<PartyKindKey, number>();
  for (const r of all) if (r.kind) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  const kindRows = kind ? all.filter((r) => r.kind === kind) : all;
  // Bakiye süzgeci (KPI kartlarının hedefi): listedeki bakiyelerin toplamı karttaki tutarla birebir aynıdır.
  const rows = kindRows.filter((r) => !sign || (sign === "alacak" ? toKurus(r.balance) > 0 : toKurus(r.balance) < 0)).sort(
    (a, b) => toKurus(b.overdue_amount) - toKurus(a.overdue_amount) || Math.abs(toKurus(b.balance)) - Math.abs(toKurus(a.balance)) || a.name.localeCompare(b.name, "tr"),
  );

  let recvK = 0;
  let payK = 0;
  let overdueK = 0;
  let overdueParties = 0;
  for (const r of kindRows) {
    const b = toKurus(r.balance);
    if (b > 0) recvK += b;
    else payK -= b;
    if (toKurus(r.overdue_amount) > 0) {
      overdueK += toKurus(r.overdue_amount);
      overdueParties += 1;
    }
  }
  // Kartlar net bakiyeyi toplar ve aynı süzgeçli cari listesine gider (açık kalem listesi brüt olduğundan oraya gitmez).
  const kindPatch = kind ? { tur: kind } : {};
  const kpis: KpiItem[] = [
    { label: "Bize borçlu", value: formatAccountMoney(fromKurus(recvK), "TRY"), icon: <ArrowDownLeft />, tone: "success", href: cariHref({}, { bakiye: "alacak", ...kindPatch }), hint: "alacaklı carilerin net bakiyesi" },
    { label: "Biz borçluyuz", value: formatAccountMoney(fromKurus(payK), "TRY"), icon: <ArrowUpRight />, tone: "warning", href: cariHref({}, { bakiye: "borc", ...kindPatch }), hint: "borçlu olduğumuz carilerin net bakiyesi" },
    {
      label: "Vadesi geçen",
      value: formatAccountMoney(fromKurus(overdueK), "TRY"),
      icon: <AlarmClock />,
      tone: overdueK > 0 ? "danger" : "neutral",
      attention: overdueK > 0,
      // Tutar yalnız carilere bağlı elle açılmış kalemlerden gelir (finance_party_balances.overdue_amount); hedef liste
      // de aynı kapsamla (kaynak=manual) açılır ki karttaki tutar ile listenin toplamı eşleşsin.
      href: cariHref({}, { gorunum: "acik", kova: "gecikmis", kaynak: "manual" }),
      hint: `${overdueParties} cari · elle açılan kalemler`,
    },
  ];

  const w = pageWindow(page, rows.length, PARTY_PAGE_SIZE, Math.max(0, Math.min(PARTY_PAGE_SIZE, rows.length - (page - 1) * PARTY_PAGE_SIZE)));
  const pageRows = rows.slice(w.offset, w.offset + PARTY_PAGE_SIZE);
  const pathParams: ParamRecord = { ...params };

  return (
    <div className="grid gap-4">
      <KpiStrip items={kpis} label="Cari özet" />

      <nav aria-label="Cari türleri" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <FilterChip href={cariHref(params, { tur: "" })} active={!kind} count={all.length}>Tümü</FilterChip>
        {PARTY_KINDS.map((k) => (
          <FilterChip key={k} href={cariHref(params, { tur: k })} active={kind === k} count={counts.get(k) ?? 0}>
            {PARTY_KIND_LABEL[k]}
          </FilterChip>
        ))}
        {sign ? (
          <FilterChip href={cariHref(params, { bakiye: "" })} active tone="danger" aria-label="Bakiye süzgecini kaldır">
            {sign === "alacak" ? "Bize borçlu" : "Biz borçluyuz"} ✕
          </FilterChip>
        ) : null}
      </nav>

      <ListToolbar
        pathname={financePath("cari")}
        params={pathParams}
        searchPlaceholder="Cari adı ara…"
        searchLabel="Carilerde ara"
        resultCount={rows.length}
        resultNoun="cari"
      />

      {error ? (
        <p role="alert" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 text-sm text-text-muted">
          Cari bakiyeleri okunamadı. Sayfayı yenileyin; sorun sürerse veritabanı güncellemesinin uygulandığından emin olun.
        </p>
      ) : rows.length === 0 ? (
        q || kind || sign ? (
          <div className="grid place-items-center rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
            <h2 className="font-display text-lg font-bold text-text">Bu filtreyle cari yok</h2>
            <Link href={cariHref({}, {})} className="mt-2 text-sm font-semibold text-accent-text hover:underline">Filtreleri temizle</Link>
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="Henüz cari yok"
            description="Hareketlerdeki karşı taraflar cari olarak burada toplanır. Yeni cari ekleyerek alacak ve borçlarınızı kişi bazında izleyin."
            tone="amber"
          />
        )
      ) : (
        <>
          <MobileCardList aria-label="Cariler">
            {pageRows.map((r) => (
              <MobileCard key={r.party_id}>
                <Link href={cariHref({}, { cari: r.party_id })} className="focus-ring block min-h-11 rounded-[var(--radius-control)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-text">{r.name}</p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {partyKindLabel(r.kind)}
                        {r.last_activity ? <> · son işlem <span className="numeric">{formatDateTr(r.last_activity)}</span></> : null}
                      </p>
                    </div>
                    <BalanceCell balance={r.balance} />
                  </div>
                  {r.overdue_amount > 0 ? (
                    <div className="mt-2">
                      <StatusPill tone="danger">Vadesi geçen {formatAccountMoney(r.overdue_amount, "TRY")}</StatusPill>
                    </div>
                  ) : null}
                </Link>
              </MobileCard>
            ))}
          </MobileCardList>

          <div className="hidden overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface md:block">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Cari bakiyeleri</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">
                  <th scope="col" className="px-4 py-2.5">Cari</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Açık alacak</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Açık borç</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Bakiye</th>
                  <th scope="col" className="px-4 py-2.5">Vadesi geçen</th>
                  <th scope="col" className="px-4 py-2.5">Son işlem</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const href = cariHref({}, { cari: r.party_id });
                  return (
                    <tr key={r.party_id} className="border-b border-line last:border-b-0 hover:bg-surface-hover/40">
                      <td className="px-4 py-3">
                        <Link href={href} className="font-semibold text-text hover:text-accent-text hover:underline">{r.name}</Link>
                        <p className="mt-0.5 text-xs text-text-muted">{partyKindLabel(r.kind)}</p>
                      </td>
                      <td className="numeric whitespace-nowrap px-4 py-3 text-right">
                        {r.receivable_open > 0 ? <Link href={cariHref({}, { gorunum: "acik", cari: "", yon: "alacak", kalem_cari: r.party_id })} className="hover:underline">{formatAccountMoney(r.receivable_open, "TRY")}</Link> : <span className="text-text-faint">—</span>}
                      </td>
                      <td className="numeric whitespace-nowrap px-4 py-3 text-right">
                        {r.payable_open > 0 ? <Link href={cariHref({}, { gorunum: "acik", cari: "", yon: "borc", kalem_cari: r.party_id })} className="hover:underline">{formatAccountMoney(r.payable_open, "TRY")}</Link> : <span className="text-text-faint">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Link href={href} className="hover:underline"><BalanceCell balance={r.balance} /></Link>
                      </td>
                      <td className="px-4 py-3">
                        {r.overdue_amount > 0 ? (
                          <Link href={cariHref({}, { gorunum: "acik", kova: "gecikmis", kalem_cari: r.party_id })}>
                            <StatusPill tone="danger">{formatAccountMoney(r.overdue_amount, "TRY")}</StatusPill>
                          </Link>
                        ) : (
                          <span className="text-text-faint">—</span>
                        )}
                      </td>
                      <td className="numeric whitespace-nowrap px-4 py-3 text-text-muted">{r.last_activity ? formatDateTr(r.last_activity) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ListPager pathname={financePath("cari")} params={pathParams} window={w} total={rows.length} />
        </>
      )}
    </div>
  );
}

export function BalanceCell({ balance, size = "sm" }: { balance: number; size?: "sm" | "lg" }) {
  const k = toKurus(balance);
  const cls = k > 0 ? "text-success-strong" : k < 0 ? "text-danger-strong" : "text-text-muted";
  return (
    <span className={`block text-right ${size === "lg" ? "" : "shrink-0"}`}>
      <span className={`numeric font-bold ${cls} ${size === "lg" ? "font-display text-2xl" : ""}`}>{formatAccountMoney(Math.abs(balance), "TRY")}</span>
      <span className="block text-xs font-normal text-text-faint">{balanceCaption(balance)}</span>
    </span>
  );
}
