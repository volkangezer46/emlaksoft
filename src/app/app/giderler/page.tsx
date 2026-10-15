import { Suspense, type ReactNode } from "react";
import { ListHero, ListPage } from "@/components/ui/list-page";
import { SkeletonCard } from "@/components/ui/viz";
import { requireModulePage } from "@/lib/require-module-page";
import { canHandleSalary } from "@/lib/finance/cash/categories";
import type { FinanceTabId, FinanceTabProps } from "@/lib/finance/ledger/types";
import { FINANCE_HERO_TEXT, FinanceActions, FinanceTabs, resolveFinanceTab, financeTabLabel } from "./_tabs/finance-shell";
import { GenelBakisTab } from "./_tabs/genel-bakis";
import { HareketlerTab } from "./_tabs/hareketler";
import { KasaBankaTab } from "./_tabs/kasa-banka";
import { CariTab } from "./_tabs/cari";
import { BelgelerTab } from "./_tabs/belgeler";
import { DuzenliTab } from "./_tabs/duzenli";
import { ButceTab } from "./_tabs/butce";
import { VergiTab } from "./_tabs/vergi";
import { RaporlarTab } from "./_tabs/raporlar";
import { AyarlarTab } from "./_tabs/ayarlar";

/**
 * Muhasebe (/app/giderler, modül `expenses`): İNCE YÖNLENDİRİCİ. Kapı + `FinanceTabProps` bir kez hazırlanır, üst kısım
 * (başlık, "Yeni kayıt", sekme şeridi) çizilir ve `?sekme=` kimliğine göre ilgili sekme bileşeni çağrılır. Her sekme kendi
 * verisini kendisi çeker (sözleşme: docs FN paketleri). Takma adlar ve eski derin bağlantılar `resolveFinanceTab`'dadır.
 */

const TABS: Record<FinanceTabId, (props: FinanceTabProps) => Promise<ReactNode>> = {
  genel: GenelBakisTab,
  hareketler: HareketlerTab,
  "kasa-banka": KasaBankaTab,
  cari: CariTab,
  belgeler: BelgelerTab,
  duzenli: DuzenliTab,
  butce: ButceTab,
  vergi: VergiTab,
  raporlar: RaporlarTab,
  ayarlar: AyarlarTab,
};

export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams)?.sekme;
  const { tab } = resolveFinanceTab({ sekme: Array.isArray(raw) ? raw[0] : raw });
  return { title: tab === "genel" ? "Muhasebe" : `${financeTabLabel(tab)} · Muhasebe` };
}

export default async function GiderlerPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { perms, tenantId, userId, role } = await requireModulePage("expenses", "/app/giderler");
  const raw = Object.fromEntries(Object.entries((await searchParams) ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const { tab, params } = resolveFinanceTab(raw);

  const canCreate = perms.expenses?.includes("create") ?? false;
  const canEdit = perms.expenses?.includes("edit") ?? false;
  const canDelete = perms.expenses?.includes("delete") ?? false;
  const canSalary = canHandleSalary(role);
  const tabProps: FinanceTabProps = {
    params,
    perms,
    tenantId: tenantId ?? "",
    userId,
    role,
    canCreate,
    canEdit,
    canDelete,
    canSalary,
    isOwnerGm: role === "owner" || role === "gm",
  };

  const Tab = TABS[tab];

  return (
    <ListPage>
      <ListHero
        eyebrow={FINANCE_HERO_TEXT.eyebrow}
        art="gider"
        title="Muhasebe"
        description={FINANCE_HERO_TEXT.description}
        // "Yeni kayıt" tam sayfa çalışma alanına gider (/app/giderler/kayit): ek veri çekmez, sekmeyi bekletmez.
        actions={canCreate ? <FinanceActions /> : null}
      />
      <FinanceTabs active={tab} />
      <Suspense key={tab} fallback={<SkeletonCard height={420} label="Sekme yükleniyor" />}>
        <Tab {...tabProps} />
      </Suspense>
    </ListPage>
  );
}
