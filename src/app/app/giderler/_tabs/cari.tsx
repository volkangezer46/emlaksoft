import Link from "@/components/ui/smart-link";
import { FileSpreadsheet } from "lucide-react";
import { FilterChip } from "@/components/ui/filter-chip";
import { uuidParam } from "@/components/ui/list-kit/list-logic";
import { now, trDayKey } from "@/lib/clock";
import { loadAccountsWithBalances } from "@/lib/finance/cash/load";
import type { FinanceTabProps } from "@/lib/finance/ledger/types";
import { partyKindOf } from "@/lib/finance/party/aging";
import { reportCenterHref } from "@/lib/report-center/links";
import { createClient } from "@/lib/supabase/server";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { OpenItemsView } from "../cari/open-items";
import { PartyDetail } from "../cari/party-detail";
import { PartyFormButton } from "../cari/party-form";
import { PartyList, cariHref, loadHiddenPartyIds } from "../cari/party-list";
import { NewOpenItemButton, type SettleAccount } from "../cari/settle-dialog";

/**
 * Cari sekmesi (?sekme=cari). Üç görünüm, hepsi URL'de:
 *  - varsayılan: cari listesi (tür çipleri, arama, bakiye, vadesi geçen rozeti, son işlem) — `finance_party_balances`
 *  - ?gorunum=acik: açık kalemler + yaşlandırma (0–30 / 31–60 / 61–90 / 90+) — `finance_open_items_v`
 *  - ?cari=<id>: cari detayı (ekstre, açık kalemler, Tahsil et / Öde, Yeni alacak / borç; malik ve danışman bölümleri)
 *  - ?kalem=<id>: elle girilmiş açık kalemin bağlantısı (FN1 `finance_open_items_v.href` ve ekstre satırları bunu üretir):
 *    kalemin carisi varsa o carinin detayı, yoksa açık kalemler listesi açılır; kalem satırı vurgulanır.
 * Maaş kategorisi (`maas`) yalnız `canSalary` (ofis sahibi + genel müdür) iken görünür — RPC'lerle aynı kural.
 * Sekme yalnız kendi verisini çeker; bağımsız okumalar `Promise.all`. P12: danışman carileri `earnings_all` olmadan
 * yalnız kullanıcının kendisine aitse görünür.
 */
export async function CariTab(props: FinanceTabProps) {
  const { params, perms, userId, tenantId, canCreate, canEdit, canSalary } = props;
  const supabase = await createClient();
  const today = trDayKey(now());
  const earningsAll = canSeeAllEarnings(perms);
  const itemId = uuidParam(params.kalem);
  // ?kalem=<id> → kalemin carisi (RLS: yalnız kendi ofisi). Maaş kalemi yetkisizse çözülmez (liste de göstermez).
  const itemParty = itemId && !uuidParam(params.cari) ? await resolveItemParty(supabase, itemId, canSalary) : null;
  const partyId = uuidParam(params.cari) || itemParty?.partyId || "";
  const view = partyId ? "detay" : params.gorunum === "acik" || itemId ? "acik" : "liste";
  const listPartyId = uuidParam(params.kalem_cari);

  // Hesaplar yalnız Tahsil et / Öde için gerekir (liste görünümünde okunmaz).
  const [hidden, cash, filterParty] = await Promise.all([
    loadHiddenPartyIds(supabase, { userId, earningsAll }),
    view === "liste" ? Promise.resolve({ available: false, accounts: [] }) : loadAccountsWithBalances(supabase),
    view === "acik" && listPartyId ? supabase.from("finance_parties").select("name").eq("id", listPartyId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const accounts: SettleAccount[] = cash.accounts
    // Cari tahsilatı ofis işidir: yalnız ofis hesapları (kişisel kasa ofis carisine karışmaz).
    .filter((a) => !a.archived_at && a.owner_scope === "office" && canCreate)
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency }));

  if (view === "detay") {
    return (
      <PartyDetail
        supabase={supabase}
        partyId={partyId}
        params={params}
        today={today}
        tenantId={tenantId}
        userId={userId}
        earningsAll={earningsAll}
        accounts={accounts}
        canCreate={canCreate}
        canEdit={canEdit}
        canSalary={canSalary}
        highlightItemId={itemId || null}
      />
    );
  }

  const kindHint = partyKindOf(params.tur);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Cari görünümleri" className="flex flex-wrap gap-1.5">
          <FilterChip href={cariHref({}, {})} active={view === "liste"}>Cariler</FilterChip>
          <FilterChip href={cariHref({}, { gorunum: "acik" })} active={view === "acik"}>Açık kalemler ve vade</FilterChip>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={view === "acik" ? reportCenterHref("tenant", "acik-kalemler") : reportCenterHref("tenant", "cari-ekstresi")}
            className="focus-ring inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 px-1 text-xs font-semibold text-accent-text hover:underline"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" /> Raporlarda aç
          </Link>
          {canCreate ? <NewOpenItemButton today={today} advisorOwnerId={earningsAll ? null : userId} /> : null}
          {canCreate ? <PartyFormButton defaultKind={kindHint} canLink={canEdit} /> : null}
        </div>
      </div>

      {view === "acik" ? (
        <OpenItemsView
          supabase={supabase}
          params={params}
          today={today}
          hidden={hidden}
          accounts={accounts}
          canSettle={canCreate}
          canSalary={canSalary}
          highlightKey={itemId ? `manual:${itemId}` : null}
          partyName={(filterParty.data as { name?: string } | null)?.name ?? null}
        />
      ) : (
        <PartyList supabase={supabase} params={params} hidden={hidden} />
      )}
    </div>
  );
}

/** `?kalem=<id>`: elle girilmiş kalemin carisi. Bulunamazsa ya da kalem maaş olup yetki yoksa null. */
async function resolveItemParty(supabase: Awaited<ReturnType<typeof createClient>>, itemId: string, canSalary: boolean): Promise<{ partyId: string | null } | null> {
  const { data, error } = await supabase.from("finance_open_items").select("party_id, category").eq("id", itemId).maybeSingle();
  if (error || !data) return null;
  const row = data as { party_id: string | null; category: string | null };
  if (row.category === "maas" && !canSalary) return null;
  return { partyId: row.party_id };
}
