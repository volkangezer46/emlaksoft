
import { financePath } from "@/lib/finance/routes";
/**
 * Mobil alt çubuğun "+ Yeni" eylem sayfası: en sık kayıtlar tek dokunuşla (müşteri, portföy, talep, randevu, görev; izin varsa
 * anlaşma, teklif ve gelir/gider kaydı).
 * Liste rol izinlerine, paket kilidine ve kapalı modüle göre `getAppActions` ile SUNUCUDA süzülmüş eylemlerden seçilir
 * (komut paleti ve üst çubuk "Yeni" menüsüyle aynı kaynak; app/layout.tsx → nav-shell-server); yetkisiz eylem görünmez. Hedefler ≥56 px yüksekliktedir.
 *
 * Bu dosya HAFİFTİR (eylem listesi + sınıf sabiti): Radix Dialog gövdesi `mobile-new-sheet-dialog.tsx` içindedir ve
 * kenar çubuğu tarafından ilk "+ Yeni" dokunuşunda yüklenir (kabuk paketine girmez); dokunma anında aynı görünümlü hafif
 * örtü (app-sidebar, tap-veil.ts) çizilir. Terim: ofisin kendi kaydı "Portföy" (portaldaki karşılığı "İlan"; B193).
 */
const SHEET_ACTIONS: readonly { href: string; label: string }[] = [
  { href: "/app/musteriler/yeni", label: "Yeni müşteri" },
  { href: "/app/portfoyler/yeni", label: "Yeni portföy" },
  { href: "/app/randevular/yeni", label: "Yeni randevu" },
  { href: "/app/gorevler/yeni", label: "Yeni görev" },
  { href: "/app/talepler/yeni", label: "Yeni talep" },
  { href: "/app/portfoy-avi/yeni", label: "Sahibinden ilan ekle" },
  { href: "/app/anlasmalar/yeni", label: "Yeni anlaşma" },
  { href: "/app/teklifler/yeni", label: "Teklif" },
  { href: financePath("kayit"), label: "Gelir/Gider kaydı" },
];

/** Çağrı merkezi için ilk eylem görüşme kaydıdır. */
const CALL_ACTION = { href: "/app/gelen-kutusu?sekme=cagri", label: "Görüşme kaydet" } as const;

/** Eylem satırı: dokunma hedefi en az 56 px (min-h-14). */
export const SHEET_ROW_CLASS =
  "focus-ring press flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 text-sm font-semibold text-ink-950 transition hover:border-brand-300 hover:bg-surface";

/** Yönetim rolleri: altıncı sık eylem gelir/gider kaydıdır (danışmanda sahibinden ilan). */
const MANAGEMENT = new Set(["owner", "gm", "branch_manager", "accounting"]);

/**
 * Rolün "+ Yeni" sayfasındaki eylemleri (`all`: yetki, paket kilidi ve kapalı modül süzgecinden geçmiş eylemler), sık
 * kullanım sırasıyla: müşteri, portföy, randevu, görev, talep, ardından role göre gelir/gider ya da sahibinden ilan.
 */
export function mobileNewActions<A extends { href: string; label: string }>(role: string | null | undefined, all: readonly A[]): A[] {
  const base = role && MANAGEMENT.has(role) ? orderForManagement(SHEET_ACTIONS) : SHEET_ACTIONS;
  const wanted = role === "call_center" ? [CALL_ACTION, ...base] : base;
  return wanted.flatMap((w) => {
    const hit = all.find((a) => a.href === w.href);
    return hit ? [{ ...hit, label: w.label }] : [];
  });
}

function orderForManagement(list: readonly { href: string; label: string }[]) {
  const finance = list.find((a) => a.href === financePath("kayit"));
  return finance ? [...list.slice(0, 5), finance, ...list.slice(5).filter((a) => a !== finance)] : list;
}

/** Sade modda "+ Yeni" menüsünde ilk görünen eylem sayısı (plan 2.1); kalanı "Tümünü göster" ile açılır. */
export const SIMPLE_NEW_LIMIT = 6;

/** Sade modda ilk `SIMPLE_NEW_LIMIT` eylem görünür, kalanı katlanır (silinmez). Tam modda hepsi görünür. */
export function splitNewActions<A>(actions: readonly A[], simple: boolean): { primary: A[]; rest: A[] } {
  if (!simple || actions.length <= SIMPLE_NEW_LIMIT) return { primary: [...actions], rest: [] };
  return { primary: actions.slice(0, SIMPLE_NEW_LIMIT), rest: actions.slice(SIMPLE_NEW_LIMIT) };
}
