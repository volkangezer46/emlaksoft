
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
  { href: "/app/talepler/yeni", label: "Yeni talep" },
  { href: "/app/randevular/yeni", label: "Yeni randevu" },
  { href: "/app/gorevler/yeni", label: "Yeni görev" },
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

/** Rolün "+ Yeni" sayfasındaki eylemleri (`all`: yetki, paket kilidi ve kapalı modül süzgecinden geçmiş eylemler). */
export function mobileNewActions<A extends { href: string; label: string }>(role: string | null | undefined, all: readonly A[]): A[] {
  const wanted = role === "call_center" ? [CALL_ACTION, ...SHEET_ACTIONS] : SHEET_ACTIONS;
  return wanted.flatMap((w) => {
    const hit = all.find((a) => a.href === w.href);
    return hit ? [{ ...hit, label: w.label }] : [];
  });
}
