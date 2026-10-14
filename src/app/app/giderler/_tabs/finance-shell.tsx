import {
  ArrowLeftRight,
  BarChart3,
  FileText,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Receipt,
  Repeat,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { MorphNavMore } from "@/components/ui/morph-nav-more";
import { splitNavTabs } from "@/lib/morph-tabs";
import type { FinanceTabId } from "@/lib/finance/ledger/types";
import { QuickEntryButtons, type AccountOption, type EntryCategoryOption, type RuleSuggestFn } from "../quick-entry";

/**
 * Muhasebe merkezinin ortak üst kısmı (TEK kaynak): sekme kimlikleri ve KULLANICIYA GÖRÜNEN etiketler, sekme çözümü,
 * "Yeni kayıt" eylemi ve sekme şeridi (5 görünür + "Diğer").
 * Sekme etiketleri başka dosyada kopyalanmaz; komut çubuğu da listeyi buradan (prop olarak) alır.
 */
export const FINANCE_BASE = "/app/giderler";

export type FinanceTabMeta = { id: FinanceTabId; label: string; icon: LucideIcon; hint: string };

/** Sıra = şerit sırası. İlk 5'i görünür, kalanı "Diğer" menüsündedir. */
export const FINANCE_TAB_META: readonly FinanceTabMeta[] = [
  { id: "genel", label: "Genel bakış", icon: LayoutDashboard, hint: "Nakit, alacak, borç ve yaklaşan ödemeler" },
  { id: "hareketler", label: "Hareketler", icon: ArrowLeftRight, hint: "Tüm gelir, gider ve transferler" },
  { id: "kasa-banka", label: "Kasa ve banka", icon: Landmark, hint: "Hesaplar, bakiyeler ve ekstre eşleştirme" },
  { id: "cari", label: "Cari", icon: Users, hint: "Kişi ve firma bakiyeleri, vadeler" },
  { id: "belgeler", label: "Belgeler", icon: FileText, hint: "Faturalar, fişler ve ekler" },
  { id: "duzenli", label: "Tekrarlayanlar", icon: Repeat, hint: "Her ay tekrarlayan ödemeler" },
  { id: "butce", label: "Bütçe", icon: PiggyBank, hint: "Bütçe ve gerçekleşen" },
  { id: "vergi", label: "Vergi", icon: Receipt, hint: "KDV ve stopaj özeti" },
  { id: "raporlar", label: "Raporlar", icon: BarChart3, hint: "Muhasebe raporları" },
  { id: "ayarlar", label: "Ayarlar", icon: Settings2, hint: "Kategoriler, kurallar ve dönem kapanışı" },
];

export const FINANCE_VISIBLE_TABS = 5;

const TAB_IDS = new Set<string>(FINANCE_TAB_META.map((t) => t.id));

export function financeTabLabel(id: FinanceTabId): string {
  return FINANCE_TAB_META.find((t) => t.id === id)?.label ?? id;
}

/** Sekme adresi: ilk sekme parametresizdir; ek sorgu parametreleri sırayla eklenir (boş değerler atlanır). */
export function financeHref(tab: FinanceTabId, query: Record<string, string | number | null | undefined> = {}): string {
  const sp = new URLSearchParams();
  if (tab !== "genel") sp.set("sekme", tab);
  for (const [k, v] of Object.entries(query)) if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `${FINANCE_BASE}?${s}` : FINANCE_BASE;
}

/** `?sekme=` çözümü: yalnız kanonik sekme kimlikleri; boş ya da bilinmeyen değer Genel bakış'a düşer (takma ad yok). */
export function resolveFinanceTab(raw: Record<string, string | undefined>): { tab: FinanceTabId; params: Record<string, string | undefined> } {
  const sekme = (raw.sekme ?? "").trim();
  if (TAB_IDS.has(sekme)) return { tab: sekme as FinanceTabId, params: raw };
  return { tab: "genel", params: { ...raw, sekme: "genel" } };
}


/**
 * Genel bakış KPI / uyarı / grafik hedefleri (TEK kaynak; sözleşme testi finance-shell.test.ts). Yalnız hedef sekmenin
 * GERÇEKTEN okuduğu parametreler kullanılır (sıfır çıkmaz metrik: tıklayan filtreli listeye düşer, filtresiz sayfaya değil):
 *  - Cari (FN4, cari/open-items.tsx): `gorunum=acik` + `yon=alacak|borc` + `kova=gecikmis|vadesi_gelmedi|0-30|…`
 *  - Hareketler (FN3, _hareketler/ledger-filters.ts): `kaynak=eski` (hesaba bağlanmamış eski giderler), `from`/`to`
 *  - Kasa ve banka (FN3): "İncelenecek" mutabakat kuyruğu sekmenin kendisindedir (ek parametre yok)
 */
export function overviewLinks() {
  return {
    receivable: financeHref("cari", { gorunum: "acik", yon: "alacak" }),
    payable: financeHref("cari", { gorunum: "acik", yon: "borc" }),
    overdue: financeHref("cari", { gorunum: "acik", kova: "gecikmis" }),
    openItems: financeHref("cari", { gorunum: "acik" }),
    /** Tahmin noktası (gelecek gün): vadesi henüz gelmemiş açık kalemler (Cari'de tek gün süzgeci yok). */
    forecastDay: financeHref("cari", { gorunum: "acik", kova: "vadesi_gelmedi" }),
    review: financeHref("kasa-banka"),
    legacy: financeHref("hareketler", { kaynak: "eski" }),
  } as const;
}

export const FINANCE_HERO_TEXT = {
  eyebrow: "Mini muhasebe",
  description: "Kasa ve banka, cari hesaplar, vadeler, belgeler ve KDV tek yerde. Yeni kayıt için G (gelir), E (gider), T (transfer); muhasebe komutları için M.",
} as const;

/** Komut çubuğuna giden sekme listesi (etiket kopyası yok: buradan türetilir). */
export function financeCommandTabs(): { id: string; label: string; hint: string; href: string }[] {
  return FINANCE_TAB_META.map((t) => ({ id: t.id, label: t.label, hint: t.hint, href: financeHref(t.id) }));
}

/** Hero eylemi: tek "Yeni kayıt" (gelir / gider / transfer) + klavye kısayolları ve komut çubuğu. */
export function FinanceActions({
  accounts,
  defaultDate,
  canSalary,
  canCreate,
  categories,
  suggestRule,
}: {
  accounts: readonly AccountOption[];
  defaultDate: string;
  canSalary: boolean;
  canCreate: boolean;
  categories: readonly EntryCategoryOption[];
  suggestRule?: RuleSuggestFn;
}) {
  return (
    <QuickEntryButtons
      accounts={accounts}
      defaultDate={defaultDate}
      canSalary={canSalary}
      office={canCreate}
      categories={categories}
      suggestRule={suggestRule}
      hotkeys
      commandTabs={financeCommandTabs()}
    />
  );
}

/** Sekme şeridi: 5 görünür sekme + "Diğer" (etkin sekme taşmadaysa görünür kümeye alınır; mobilde etiketler hep görünür). */
export function FinanceTabs({ active }: { active: FinanceTabId }) {
  const items = FINANCE_TAB_META.map((t) => ({ id: t.id, href: financeHref(t.id), label: t.label, icon: t.icon }));
  const { shown, more } = splitNavTabs(items, active, FINANCE_VISIBLE_TABS);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <SegmentTabs label="Muhasebe sekmeleri" active={active} items={shown} className="min-w-0 flex-1" />
      {more.length > 0 ? (
        <MorphNavMore
          label="Muhasebe sekmeleri"
          items={more.map(({ icon: Icon, ...rest }) => ({ ...rest, iconNode: <Icon className="h-4 w-4" aria-hidden /> }))}
        />
      ) : null}
    </div>
  );
}
