import { Lock } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EmptyState } from "@/components/ui/empty-state";
import { loadAccountsWithBalances } from "@/lib/finance/cash/load";
import { DuzenliTab } from "../giderler/_tabs/duzenli";
import { HareketlerTab, type EntriesNav } from "../giderler/_tabs/hareketler";
import { KasaBankaTab } from "../giderler/_tabs/kasa-banka";
import { QuickEntryButtons, type AccountOption } from "../giderler/quick-entry";

const KASAM_NAV: EntriesNav = { base: "/app/hesabim", sekme: "kasam" };
const kasamHref = (accountId: string) => `/app/hesabim?sekme=kasam&hesap=${accountId}`;

/**
 * "Kasam": kullanıcının KENDİ kişisel kasa/banka hesapları, hareketleri ve düzenli ödemeleri (`/app/hesabim?sekme=kasam`).
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
  const options: AccountOption[] = mine
    .filter((a) => !a.archived_at)
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, scope: a.owner_scope }));
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;

  return (
    <div className="grid gap-8">
      <section aria-label="Kasam" className="grid gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 font-display text-lg font-bold text-text"><Lock className="h-4 w-4" aria-hidden="true" /> Kasam</h2>
            <p className="text-xs text-text-muted">Kendi gelir ve giderlerinizi takip edin. Yalnız siz görürsünüz; ofis sahibi dahil kimse göremez ve ofis kâr-zararına girmez.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <QuickEntryButtons accounts={options} defaultDate={today} canSalary={false} />
          </div>
        </header>
        <KasaBankaTab supabase={supabase} accounts={mine} today={today} canOffice={false} entriesHref={kasamHref} />
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
