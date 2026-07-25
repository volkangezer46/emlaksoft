import { describe, expect, it } from "vitest";
import {
  canAccessModule,
  DEFAULT_MATRIX,
  hasPermission,
  type AppAction,
  type AppModule,
  type AppRole,
} from "./permissions";

/**
 * Yetki matrisi testleri.
 *
 * NEDEN ÖNEMLİ: Bu matris `permission_defaults` tablosuna seed edilmiş
 * durumda ve panelin her sayfası bunun üzerinden kapı kontrolü yapıyor.
 * Bir modül eklerken yanlışlıkla `readonly` rolüne yazma yetkisi vermek ya da
 * `advisor`a fatura ekranını açmak derleyicinin göremeyeceği bir hata —
 * `AppAction[]` her ikisinde de geçerli bir tip.
 *
 * Testler tek tek satır ezberlemiyor; DEĞİŞMEZLERİ (invariant) koruyor.
 */

const ROLLER = Object.keys(DEFAULT_MATRIX) as AppRole[];
const YAZMA: AppAction[] = ["create", "edit", "delete"];

describe("değişmezler", () => {
  it("readonly rolü HİÇBİR modülde yazamaz", () => {
    for (const [mod, actions] of Object.entries(DEFAULT_MATRIX.readonly)) {
      expect(actions, `readonly.${mod}`).toEqual(["view"]);
    }
  });

  it("readonly için her yazma aksiyonu reddedilir", () => {
    for (const mod of Object.keys(DEFAULT_MATRIX.readonly) as AppModule[]) {
      for (const action of YAZMA) {
        expect(hasPermission("readonly", mod, action), `readonly ${mod}.${action}`).toBe(false);
      }
    }
  });

  it("bir modülde yazma yetkisi varsa görüntüleme de vardır", () => {
    // "Ekleyebilir ama listeyi göremez" tutarsız bir durum; arayüz bunu
    // gösteremez ve kullanıcı ne yaptığını göremez.
    for (const rol of ROLLER) {
      for (const [mod, actions] of Object.entries(DEFAULT_MATRIX[rol])) {
        if (actions.some((a) => YAZMA.includes(a))) {
          expect(actions, `${rol}.${mod}`).toContain("view");
        }
      }
    }
  });

  it("hiçbir rolde aksiyon listesi boş değil", () => {
    // Boş dizi "modül var ama hiçbir şey yapılamaz" demek — matriste
    // modülü hiç yazmamakla aynı, ama arayüzde farklı davranabilir.
    for (const rol of ROLLER) {
      for (const [mod, actions] of Object.entries(DEFAULT_MATRIX[rol])) {
        expect(actions.length, `${rol}.${mod}`).toBeGreaterThan(0);
      }
    }
  });

  it("aksiyon listelerinde tekrar yok", () => {
    for (const rol of ROLLER) {
      for (const [mod, actions] of Object.entries(DEFAULT_MATRIX[rol])) {
        expect(new Set(actions).size, `${rol}.${mod}`).toBe(actions.length);
      }
    }
  });

  it("owner her modüle tam yetkili", () => {
    for (const [mod, actions] of Object.entries(DEFAULT_MATRIX.owner)) {
      expect(actions, `owner.${mod}`).toEqual(["view", "create", "edit", "delete"]);
    }
  });

  it("owner en geniş yetkiye sahip: hiçbir rol owner'da olmayan bir modüle erişemez", () => {
    const ownerModulleri = new Set(Object.keys(DEFAULT_MATRIX.owner));
    for (const rol of ROLLER) {
      for (const mod of Object.keys(DEFAULT_MATRIX[rol])) {
        expect(ownerModulleri.has(mod), `${rol}.${mod} owner'da yok`).toBe(true);
      }
    }
  });
});

describe("rol sınırları", () => {
  it("advisor ekip ve fatura modüllerine erişemez", () => {
    expect(canAccessModule("advisor", "team")).toBe(false);
    expect(canAccessModule("advisor", "billing")).toBe(false);
  });

  it("advisor ayarları yalnızca görüntüler, değiştiremez", () => {
    expect(hasPermission("advisor", "settings", "view")).toBe(true);
    expect(hasPermission("advisor", "settings", "edit")).toBe(false);
  });

  it("çağrı merkezi portföy ve komisyona erişemez", () => {
    expect(canAccessModule("call_center", "properties")).toBe(false);
    expect(canAccessModule("call_center", "commissions")).toBe(false);
  });

  it("muhasebe portföy düzenleyemez ama komisyonda tam yetkili", () => {
    expect(canAccessModule("accounting", "properties")).toBe(false);
    expect(hasPermission("accounting", "commissions", "delete")).toBe(true);
  });

  it("muhasebe fatura silemez (yalnızca oluşturur/düzenler)", () => {
    expect(hasPermission("accounting", "billing", "create")).toBe(true);
    expect(hasPermission("accounting", "billing", "delete")).toBe(false);
  });
});

describe("hasPermission kenar durumları", () => {
  /*
   * DIKKAT — burada bilerek sabitlenen bir ASIMETRI var:
   *
   *   role = null / undefined / ""  -> `role || "advisor"` devreye girer,
   *                                    kullanici ADVISOR yetkilerini alir.
   *   role = "typo_rol"             -> truthy oldugu icin fallback CALISMAZ;
   *                                    matriste karsiligi yok, HIC yetki yok.
   *
   * Yani bos rol genis, hatali rol dar yetki veriyor. Ikincisi guvenli taraf.
   * Birincisi (bos rol -> advisor) dikkat edilmesi gereken yer: profil
   * kaydinda role kolonu bos kalirsa kullanici sessizce danisman yetkisi alir.
   * Bu fonksiyon yalnizca fallback/acil durum yolu — gercek calisma zamani
   * yetkisi permissions-effective.ts uzerinden hesaplaniyor.
   */
  it("bilinmeyen rol HIC yetki almaz (deny-by-default)", () => {
    expect(hasPermission("uydurma_rol", "customers", "view")).toBe(false);
    expect(hasPermission("uydurma_rol", "dashboard", "view")).toBe(false);
  });

  it("null/undefined/boş rol advisor'a düşer", () => {
    for (const rol of [null, undefined, ""]) {
      expect(hasPermission(rol, "customers", "view")).toBe(true);
      expect(hasPermission(rol, "billing", "view")).toBe(false);
    }
  });

  it("matriste tanımsız modül için reddeder, patlamaz", () => {
    expect(() => hasPermission("readonly", "billing", "view")).not.toThrow();
    expect(hasPermission("readonly", "billing", "view")).toBe(false);
  });

  it("canAccessModule yalnızca view'a bakar", () => {
    expect(canAccessModule("readonly", "customers")).toBe(true);
    expect(hasPermission("readonly", "customers", "edit")).toBe(false);
  });
});
