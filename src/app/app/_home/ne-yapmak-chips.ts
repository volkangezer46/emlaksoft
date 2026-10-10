import type { HomeVariant } from "./home-layout";

/**
 * "Ne yapmak istiyorsun?" kutusunun altındaki örnek çipler (rol bazlı). Çipe tıklamak komut paletini o metinle açar;
 * metinler paletin anlayacağı günlük Türkçe ifadelerdir (saf liste, vitest kapsamında).
 */
export function neYapmakChips(variant: HomeVariant, isOwner: boolean): string[] {
  switch (variant) {
    case "management":
      return isOwner ? ["ilan ata", "bugün ne oldu", "müşteri ekle", "TV modu"] : ["ilan ata", "bugün ne oldu", "müşteri ekle", "komisyon"];
    case "advisor":
    case "team_lead":
      return ["müşteri ekle", "randevu", "ilan paylaş", "komisyonum"];
    case "accounting":
      return ["komisyon", "gider ekle", "tahsilat"];
    case "call_center":
      return ["arama", "müşteri ekle"];
  }
}
