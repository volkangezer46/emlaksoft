import type { HomeVariant } from "./home-layout";
import type { AppModule } from "@/lib/permissions";
import { getPaletteRows } from "@/lib/palette-core";

/** Rolün paletteki yetkisi (menü/palet süzgeciyle aynı): erişilebilen ve oluşturulabilen modüller. */
export type ChipPermissions = {
  accessible: readonly AppModule[];
  creatable?: readonly AppModule[];
  locked?: readonly string[];
  closed?: readonly string[];
};

function variantChips(variant: HomeVariant, isOwner: boolean): string[] {
  switch (variant) {
    case "management":
      return isOwner ? ["portföy dağıt", "bugün ne oldu", "müşteri ekle", "TV modu"] : ["portföy dağıt", "bugün ne oldu", "müşteri ekle", "komisyon"];
    case "advisor":
    case "team_lead":
      return ["müşteri ekle", "randevu", "ilan gönder", "kazancım"];
    case "accounting":
      return ["komisyon", "gider ekle", "tahsilat"];
    case "call_center":
      return ["arama", "müşteri ekle"];
  }
}

/** Yetkiyle süzülünce çip kalmazsa (ör. salt okunur: oluşturma yok) gösterilecek göz atma çipleri. */
const BROWSE_FALLBACK = ["müşteriler", "portföyler", "randevular", "raporlar", "komisyon"];

/**
 * "Ne yapmak istiyorsun?" kutusunun altındaki örnek çipler (rol bazlı). Çipe tıklamak komut paletini o metinle açar;
 * metinler paletin anlayacağı günlük Türkçe ifadelerdir.
 *
 * `perms` verilirse (B058/B184-c) her çip PALETİN KENDİ işleviyle (getPaletteRows) denenir ve sonuç vermeyen çip düşer:
 * salt okunur rol "müşteri ekle" görmez, yerine göz atma çipleri ("müşteriler") gelir. Sözleşme testi
 * (ne-yapmak-chips.test.ts) her rolde her çipin en az bir sonuç verdiğini doğrular. Çağıran izinleri geçmezse liste
 * rol varyantının sabit hâlidir (geriye uyumlu).
 */
export function neYapmakChips(variant: HomeVariant, isOwner: boolean, perms?: ChipPermissions): string[] {
  const base = variantChips(variant, isOwner);
  if (!perms) return base;
  const works = (chip: string) => getPaletteRows(chip, perms).length > 0;
  const kept = base.filter(works);
  if (kept.length >= 2) return kept;
  const extra = BROWSE_FALLBACK.filter((c) => !kept.includes(c) && works(c));
  return [...kept, ...extra].slice(0, Math.max(2, Math.min(4, kept.length + extra.length)));
}
