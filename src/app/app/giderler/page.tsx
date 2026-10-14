import { Suspense, type ReactNode } from "react";
import { ListHero, ListPage } from "@/components/ui/list-page";
import { SkeletonCard } from "@/components/ui/viz";
import { requireModulePage } from "@/lib/require-module-page";
import { requirePermission } from "@/lib/require-permission";
import { now as nowMs, trDayKey } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { CASH_CATEGORIES, canHandleSalary } from "@/lib/finance/cash/categories";
import { loadAccountsWithBalances } from "@/lib/finance/cash/load";
import { loadCategories } from "@/lib/finance/ledger/load";
import type { FinanceCategory, FinanceTabId, FinanceTabProps } from "@/lib/finance/ledger/types";
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
import type { AccountOption, EntryCategoryOption, RuleSuggestion } from "./quick-entry";

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

/** Sistem + ofis kategorileri → pencere çipleri (ofis kategorileri `x_…`; varsayılan KDV/stopaj oranlarıyla). */
function toEntryCategories(list: readonly FinanceCategory[]): EntryCategoryOption[] {
  const out = list
    .filter((c) => !c.archived && c.key && c.label)
    .map((c) => ({ value: c.key, label: c.label, direction: c.direction, custom: c.source === "custom", vatRate: c.defaultVatRate, withholdingRate: c.defaultWithholdingRate, expenseCategory: c.expenseCategory }));
  return out.length > 0 ? out : CASH_CATEGORIES.map((c) => ({ value: c.value, label: c.label, direction: c.direction, expenseCategory: c.direction === "out" ? (c.expenseCategory ?? null) : null }));
}

/** Kural önerisi (finance_rule_suggest): yeni kayıt penceresi açıklama/cari yazıldıkça çağırır. Yalnız okuma; `expenses:view`. */
async function suggestRule(input: { text: string; amount: number | null; direction: "in" | "out" }): Promise<RuleSuggestion | null> {
  "use server";
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return null;
  const text = String(input?.text ?? "").trim().slice(0, 200);
  if (text.length < 3) return null;
  const amount = typeof input?.amount === "number" && Number.isFinite(input.amount) ? input.amount : null;
  const direction = input?.direction === "in" ? "in" : "out";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_rule_suggest", { p_text: text, p_amount: amount, p_iban_last4: null, p_direction: direction });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { rule_id?: string | null; category?: string | null; party_id?: string | null; mode?: string | null };
  if (!row.category) return null;
  return { ruleId: String(row.rule_id ?? ""), category: String(row.category), partyId: row.party_id ?? null, mode: row.mode === "auto" ? "auto" : "suggest" };
}

/** "Yeni kayıt" eylemi: hesap ve kategori listesini kendisi çeker (paralel), sekmeden bağımsız akar. */
async function HeroActions({ canCreate, canSalary }: { canCreate: boolean; canSalary: boolean }) {
  const supabase = await createClient();
  const [cash, categories] = await Promise.all([loadAccountsWithBalances(supabase), loadCategories()]);
  const accounts: AccountOption[] = cash.accounts
    .filter((a) => !a.archived_at && (a.owner_scope === "user" || canCreate))
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, scope: a.owner_scope }));
  if (!canCreate && accounts.length === 0) return null;
  return (
    <FinanceActions
      accounts={accounts}
      defaultDate={trDayKey(nowMs())}
      canSalary={canSalary}
      canCreate={canCreate}
      categories={toEntryCategories(categories)}
      suggestRule={canCreate ? suggestRule : undefined}
    />
  );
}

function HeroActionsSkeleton() {
  return <div className="skeleton h-9 w-32 rounded-[var(--radius-control)] touch:h-11" aria-hidden="true" />;
}

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
        actions={
          // Pencerenin hesap/kategori verisi sekme verisini BEKLETMEZ (şelale yok): kendi Suspense sınırında akar.
          <Suspense fallback={<HeroActionsSkeleton />}>
            <HeroActions canCreate={canCreate} canSalary={canSalary} />
          </Suspense>
        }
      />
      <FinanceTabs active={tab} />
      <Suspense key={tab} fallback={<SkeletonCard height={420} label="Sekme yükleniyor" />}>
        <Tab {...tabProps} />
      </Suspense>
    </ListPage>
  );
}
