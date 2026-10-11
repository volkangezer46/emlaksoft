import { getAppActions, type PaletteEntry } from "@/lib/palette-core";
import type { AppModule } from "@/lib/permissions";

/**
 * Mobil alt çubuğun "+ Yeni" eylem sayfası: en sık kayıtlar tek dokunuşla (müşteri, ilan, talep, randevu, görev).
 * Liste rol izinlerine, paket kilidine ve kapalı modüle göre `getAppActions` ile süzülür (komut paleti ve üst çubuk
 * "Yeni" menüsüyle aynı kaynak); yetkisiz eylem görünmez. Hedefler ≥56 px yüksekliktedir.
 *
 * Bu dosya HAFİFTİR (eylem listesi + sınıf sabiti): Radix Dialog gövdesi `mobile-new-sheet-dialog.tsx` içindedir ve
 * kenar çubuğu tarafından ilk "+ Yeni" dokunuşunda yüklenir (kabuk paketine girmez).
 */
const SHEET_ACTIONS: readonly { href: string; label: string }[] = [
  { href: "/app/musteriler/yeni", label: "Yeni müşteri" },
  { href: "/app/portfoyler/yeni", label: "Yeni ilan" },
  { href: "/app/talepler/yeni", label: "Yeni talep" },
  { href: "/app/randevular/yeni", label: "Yeni randevu" },
  { href: "/app/gorevler/yeni", label: "Yeni görev" },
];

/** Çağrı merkezi için ilk eylem görüşme kaydıdır. */
const CALL_ACTION = { href: "/app/gelen-kutusu?sekme=cagri", label: "Görüşme kaydet" } as const;

/** Eylem satırı: dokunma hedefi en az 56 px (min-h-14). */
export const SHEET_ROW_CLASS =
  "focus-ring press flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 text-sm font-semibold text-ink-950 transition hover:border-brand-300 hover:bg-surface";

/** Rolün "+ Yeni" sayfasındaki eylemleri (yetki, paket kilidi ve kapalı modül süzgeciyle). */
export function mobileNewActions(
  role: string | null | undefined,
  creatable: readonly AppModule[],
  locked: readonly string[],
  closed: readonly string[],
): PaletteEntry[] {
  const all = getAppActions(creatable, "", locked, closed);
  const wanted = role === "call_center" ? [CALL_ACTION, ...SHEET_ACTIONS] : SHEET_ACTIONS;
  return wanted.flatMap((w) => {
    const hit = all.find((a) => a.href === w.href);
    return hit ? [{ ...hit, label: w.label }] : [];
  });
}
