import { Lock } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EmptyState } from "@/components/ui/empty-state";
import { isUuid } from "@/lib/finance/cash/input";
import { loadAccountsWithBalances } from "@/lib/finance/cash/load";
import { DuzenliTab } from "@/app/app/finans/(merkez)/_tabs/duzenli";
import { HareketlerTab, type EntriesNav } from "@/app/app/finans/(merkez)/_tabs/hareketler";
import { KasaBankaTab } from "@/app/app/finans/(merkez)/_tabs/kasa-banka";
import { QuickEntryButtons } from "@/app/app/finans/(merkez)/quick-entry";
import { PageHeader } from "@/components/ui/page-header";
import { earningsHref, earningsPath } from "@/lib/finance/routes";

const KASAM_NAV: EntriesNav = { base: earningsPath("kasam"), accountsHref: earningsPath("kasam") };
const kasamHref = (accountId: string) => earningsHref("kasam", { hesap: accountId });
const kasamEkstreHref = (accountId: string) => earningsHref("kasam", { ekstre: accountId });

/**
 * "Kasam": kullanıcının KENDİ kişisel kasa/banka hesapları, hareketleri ve düzenli ödemeleri (`/app/kazancim/kasam`, Kazancım > Kasam).
 * Paket A/B bileşenleri scope=user kipinde yeniden kullanılır. Ofis hesabı/hareketi/kuralı bu görünümde ASLA sorgulanmaz ya da çizilmez
 * (ofis sahibi bile yalnız kendi kişisel verisini görür). Kapı `dashboard:view`; asıl kural RPC + RLS'dedir.
 */
export async function KasamTab({
  supabase,
  userId,
  params,
  today,
}: {
  supabase: SupabaseClient;
  userId: string;
  params: Record<string, string | string[] | undefined>;
  today: string;
}) {
  const cash = await loadAccountsWithBalances(supabase);
  if (!cash.available) {
    return <EmptyState icon={Lock} title="Kasam henüz etkin değil" description="Veritabanı güncellemesi uygulandığında kişisel kasanız burada açılır." tone="amber" />;
  }
  // Ofis hesapları (expenses yetkisi olanlarda RLS'ten gelir) burada süzülür: yalnız bu kullanıcının kişisel hesapları.
  const mine = cash.accounts.filter((a) => a.owner_scope === "user" && a.owner_user_id === userId);
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;

  return (
    <div className="grid gap-8">
      <section aria-label="Kasam" className="grid gap-4">
        <PageHeader
          className="mb-0"
          eyebrow="Kişisel kasa"
          title="Kasam"
          description="Kendi gelir ve giderlerinizi takip edin. Yalnız siz görürsünüz; ofis sahibi dahil kimse göremez ve ofis kâr-zararına girmez."
          actions={mine.some((a) => !a.archived_at) ? <QuickEntryButtons personal /> : null}
        />
        <KasaBankaTab supabase={supabase} accounts={mine} today={today} canOffice={false} entriesHref={kasamHref} statementHref={kasamEkstreHref} reviewAccountId={isUuid(flat.ekstre) ? flat.ekstre : null} />
      </section>

      <section aria-label="Düzenli ödemelerim" id="duzenli" className="grid gap-4">
        <h2 className="font-display text-lg font-bold text-text">Düzenli ödemelerim</h2>
        <DuzenliTab
          supabase={supabase}
          accounts={mine}
          scope="user"
          ownerUserId={userId}
          today={today}
          canCreate
          canEdit
          canDelete
          canSalary={false}
          entriesHref={kasamHref}
        />
      </section>

      <section aria-label="Hareketlerim" id="hareketler" className="grid gap-4">
        <h2 className="font-display text-lg font-bold text-text">Hareketlerim</h2>
        <HareketlerTab
          supabase={supabase}
          params={flat}
          accounts={mine}
          today={today}
          canCreate
          canEdit
          canDelete
          canSalary={false}
          nav={KASAM_NAV}
          limitToAccounts
        />
      </section>
    </div>
  );
}
