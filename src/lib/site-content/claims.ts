/**
 * PAZARLAMA İDDİASI (kullanıcı iddiası) TEK YERDE. Ana sayfadaki "ilk ve tek" ifadesi buradan gelir; metni değiştirmek
 * veya kapatmak için Admin > Site içeriği > Değerleme bölümü kullanılır (varsayılan: açık, kullanıcı talebi).
 *
 * KANITLANABİLİR OLMALI: "ilk" / "tek" gibi üstünlük iddiaları Reklam Kurulu ve haksız rekabet (TTK m.54-55, 6502 sayılı
 * Kanun) bakımından ispat yükü doğurur. Dayanak dosyasını (pazar taraması, tarihli ekran kayıtları, rakip özellik karşılaştırması,
 * hukuk görüşü) saklayın; doğrulanamıyorsa ifadeyi kapatın veya somut tanımla (`concrete`) sınırlayın.
 */
export const PIONEER_CLAIM = {
  /** Ayrı cümle/rozet olarak gösterilen iddia (admin tek tıkla kapatabilir). */
  text: "Türkiye'de ilk ve tek.",
  /** Somut, doğrulanabilir tanım: iddia kapatılsa bile bu tanım kalır. */
  concrete: "Emlak CRM'inin içinde, ada/parsel bazlı değerleme ve PDF rapor sunan entegre sistem.",
  /** Editörde iddia alanının yanında gösterilen uyarı. */
  evidenceWarning:
    "KANITLANABİLİR OLMALI: “ilk ve tek” bir pazarlama iddiasıdır. Dayanak dosyasını (pazar taraması, tarihli kayıtlar, hukuk görüşü) saklayın; kanıtlayamıyorsanız bu cümleyi kapatın.",
} as const;
