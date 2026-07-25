/**
 * Türkçe metin karşılaştırma yardımcıları.
 *
 * NEDEN AYRI BİR DOSYA: Aynı katlama mantığı `price-health.ts` ve
 * `matching.ts` içinde ayrı ayrı, birbirinden habersiz yazılmıştı. Arama
 * kutularının hepsinde aynı davranmak zorunda; tek yerde olmalı.
 *
 * TEMEL SORUN: `"İstanbul".toLowerCase()` JS'te `"i̇stanbul"` üretir — küçük
 * i'nin ardına BİRLEŞEN NOKTA (U+0307) ekler. Bu dizge `"istanbul"` ile
 * eşleşmez. `toLocaleLowerCase("tr")` doğru sonucu verir ama bu sefer
 * `"IĞDIR" → "ığdır"` olur ve kullanıcı `"igdir"` yazdığında bulamaz.
 * Bu yüzden önce Türkçe kurallarıyla küçültüp sonra aksanları düzleştiriyoruz.
 */

/** ı ğ ü ş ö ç → i g u s o c (aksan düzleştirme) */
const FOLD: Record<string, string> = {
  ı: "i",
  ğ: "g",
  ü: "u",
  ş: "s",
  ö: "o",
  ç: "c",
  â: "a",
  î: "i",
  û: "u",
};

/**
 * Aranabilir biçime indirger: Türkçe küçültme + aksan düzleştirme +
 * birleşen işaretlerin atılması + boşluk sadeleştirme.
 *
 *   foldTr("İSTANBUL")  === "istanbul"
 *   foldTr("Iğdır")     === "igdir"
 *   foldTr("Şişli ")    === "sisli"
 */
export function foldTr(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/[ığüşöçâîû]/g, (ch) => FOLD[ch] ?? ch)
    .normalize("NFD")
    // Birleşen aksan işaretleri (U+0300–U+036F) — Türkçe küçültmenin bıraktığı
    // "i + birleşen nokta" kalıntısını da temizler. Kaçış dizisiyle yazıldı ki
    // dosya kodlaması ne olursa olsun aynı aralığı ifade etsin.
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Yazılan parçanın metinde geçip geçmediği. Boş sorgu her şeyi eşler ki
 * arama kutusu ilk açıldığında liste dolu görünsün.
 */
export function matchesTr(haystack: string | null | undefined, query: string): boolean {
  const q = foldTr(query);
  if (!q) return true;
  return foldTr(haystack).includes(q);
}

/**
 * Türkçe alfabetik sıralama. `Intl.Collator` doğru sırayı bilir:
 * ç, ğ, ı, i, ö, ş, ü harflerini kendi yerlerine koyar — `<` operatörü ya da
 * varsayılan `localeCompare()` bunu yapmaz ("Çankaya" C'lerden sonra değil,
 * Ç'de olmalı).
 *
 * Collator kurulumu pahalı olduğu için modül düzeyinde bir kez yaratılır.
 */
const collator = new Intl.Collator("tr-TR", { sensitivity: "base", numeric: true });

export function compareTr(a: string | null | undefined, b: string | null | undefined): number {
  return collator.compare(a ?? "", b ?? "");
}

/**
 * Arama sonuçlarını alaka sırasına dizer: önce baştan eşleşenler, sonra
 * içinde geçenler, her grup kendi içinde Türkçe alfabetik.
 *
 * Kullanıcı "kad" yazdığında "Kadıköy" en üstte olmalı — "Beykadı" değil.
 */
export function rankTr<T>(items: T[], query: string, label: (item: T) => string): T[] {
  const q = foldTr(query);
  if (!q) return [...items].sort((a, b) => compareTr(label(a), label(b)));

  const scored: { item: T; rank: number; text: string }[] = [];
  for (const item of items) {
    const text = foldTr(label(item));
    const at = text.indexOf(q);
    if (at < 0) continue;
    // 0 = baştan eşleşme, 1 = kelime başı, 2 = ortada
    const rank = at === 0 ? 0 : text[at - 1] === " " ? 1 : 2;
    scored.push({ item, rank, text });
  }
  scored.sort((a, b) => a.rank - b.rank || compareTr(a.text, b.text));
  return scored.map((s) => s.item);
}
