import {
  ArrowLeftRight,
  BarChart3,
  Coins,
  FileCheck2,
  FileText,
  HandCoins,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Receipt,
  Repeat,
  Settings2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { financeHref, type FinanceSection } from "@/lib/finance/routes";
import { QuickEntryButtons } from "../quick-entry";

/**
 * Finans merkezinin ortak üst kısmı (TEK kaynak): alt alanların KULLANICIYA GÖRÜNEN etiketleri ve ipuçları, Genel bakış
 * kart hedefleri ve "Yeni kayıt" eylemi. Alt alanlar gerçek yollardır (`/app/finans/<bölüm>`, adres üreticisi
 * `@/lib/finance/routes`); sekme şeridi menü merkezinin şerididir (nav-roles "Finans"), burada ikinci şerit çizilmez.
 */

export type FinanceSectionMeta = { id: Exclude<FinanceSection, "kayit">; label: string; icon: LucideIcon; hint: string; module: "expenses" | "commissions" };

/** Sıra = menü şeridi sırası (nav-roles FINANS ile aynı). */
export const FINANCE_SECTION_META: readonly FinanceSectionMeta[] = [
  { id: "genel", label: "Genel bakış", icon: LayoutDashboard, hint: "Nakit, alacak, borç ve yaklaşan ödemeler", module: "expenses" },
  { id: "hareketler", label: "Hareketler", icon: ArrowLeftRight, hint: "Tüm gelir, gider ve transferler", module: "expenses" },
  { id: "kasa-banka", label: "Kasa ve banka", icon: Landmark, hint: "Hesaplar, bakiyeler ve ekstre eşleştirme", module: "expenses" },
  { id: "cari", label: "Alacak ve borç", icon: Users, hint: "Kişi ve firma bakiyeleri, vadeler", module: "expenses" },
  { id: "komisyon", label: "Komisyon", icon: Coins, hint: "Komisyon defteri, tahsilat ve paylaşım", module: "commissions" },
  { id: "hakedis", label: "Danışman ödemeleri", icon: HandCoins, hint: "Danışman payları ve ödeme kuyruğu", module: "commissions" },
  { id: "tahsilat", label: "Tahsilatlar", icon: Wallet, hint: "Kira, bina aidatı ve aidat borçlarının nakit tarafı", module: "expenses" },
  { id: "faturalar", label: "Faturalar", icon: FileCheck2, hint: "e-Fatura ve e-Arşiv", module: "expenses" },
  { id: "belgeler", label: "Belgeler", icon: FileText, hint: "Fişler ve ekler", module: "expenses" },
  { id: "tekrarlayan", label: "Tekrarlayanlar", icon: Repeat, hint: "Her ay tekrarlayan ödemeler", module: "expenses" },
  { id: "butce", label: "Bütçe", icon: PiggyBank, hint: "Bütçe ve gerçekleşen", module: "expenses" },
  { id: "vergi", label: "Vergi", icon: Receipt, hint: "KDV ve stopaj özeti", module: "expenses" },
  { id: "raporlar", label: "Raporlar", icon: BarChart3, hint: "Finans raporları", module: "expenses" },
  { id: "ayarlar", label: "Ayarlar", icon: Settings2, hint: "Kategoriler, kurallar ve dönem kapanışı", module: "expenses" },
];

export function financeSectionLabel(id: FinanceSection): string {
  if (id === "kayit") return "Yeni kayıt";
  return FINANCE_SECTION_META.find((t) => t.id === id)?.label ?? id;
}

/** Alt sayfa başlığı: "Hareketler · Finans" (Genel bakış yalnız "Finans"). */
export function financeTitle(id: FinanceSection): string {
  return id === "genel" ? "Finans" : `${financeSectionLabel(id)} · Finans`;
}

/**
 * Genel bakış KPI / uyarı / grafik hedefleri (TEK kaynak; sözleşme testi finance-shell.test.ts). Yalnız hedef sayfanın
 * GERÇEKTEN okuduğu parametreler kullanılır (sıfır çıkmaz metrik: tıklayan filtreli listeye düşer, filtresiz sayfaya değil):
 *  - Cari (FN4, cari/open-items.tsx): `gorunum=acik` + `yon=alacak|borc` + `kova=gecikmis|vadesi_gelmedi|0-30|…`
 *  - Hareketler (FN3, _hareketler/ledger-filters.ts): `kaynak=eski` (hesaba bağlanmamış eski giderler), `from`/`to`
 *  - Kasa ve banka (FN3): "İncelenecek" mutabakat kuyruğu sayfanın kendisindedir (ek parametre yok)
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
  eyebrow: "Finans",
  description: "Kasa ve banka, alacak ve borç, komisyon, tahsilat, belgeler ve KDV tek yerde. Yeni kayıt için G (gelir), E (gider), T (transfer); finans komutları için M.",
  /** Muhasebe yetkisi olmayan (yalnız komisyon) kullanıcı. */
  commissionsOnly: "Komisyon defteri, paylaşım ve tahsilat durumu tek yerde.",
} as const;

/** Komut çubuğuna giden alt alan listesi (etiket kopyası yok: buradan türetilir). Yalnız izinli modüllerin alanları. */
export function financeCommandTabs(modules: { expenses: boolean; commissions: boolean } = { expenses: true, commissions: true }): { id: string; label: string; hint: string; href: string }[] {
  return FINANCE_SECTION_META.filter((t) => modules[t.module]).map((t) => ({ id: t.id, label: t.label, hint: t.hint, href: financeHref(t.id) }));
}

/** Hero eylemi: "Yeni kayıt" (tam sayfa kayıt çalışma alanı; gelir / gider / transfer / belge / toplu) + kısayollar ve komut çubuğu. */
export function FinanceActions({ commissions = true }: { commissions?: boolean }) {
  return <QuickEntryButtons hotkeys commandTabs={financeCommandTabs({ expenses: true, commissions })} />;
}
