/**
 * FOTOĞRAF KARMASI (dHash, SAF). 9x8 gri tonlu küçük görüntüden 64 bitlik "fark karması": her satırda soldaki piksel sağdakinden
 * parlaksa bit 1. İki fotoğraf Hamming uzaklığı ≤ 10/64 ise büyük olasılıkla aynı görüntüdür (yeniden boyutlandırma/sıkıştırma
 * dayanıklı). Görüntü çözme/yeniden boyutlandırma BU dosyada YOK (sunucuda `sharp`, eklentide `OffscreenCanvas` ile yapılabilir);
 * burası yalnız karma hesabı ve benzerlik kararıdır. Karma yoksa sinyal "ölçülemedi" sayılır ve skorun paydasından çıkar
 * (sahte skor yok).
 */

export const DHASH_RE = /^[0-9a-f]{16}$/;
/** Bu uzaklık ve altı "aynı fotoğraf" sayılır (tam puan). */
export const HAMMING_SAME = 10;
/** Bu uzaklık ve üstü "farklı" (sıfır puan); arası doğrusal. */
export const HAMMING_DIFFERENT = 26;

const POP4 = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** 9 sütun x 8 satır gri tonlu piksel (72 bayt, satır sırası) → 16 haneli hex karma. Geçersiz boyutta null. */
export function dhashFromGray9x8(pixels: ArrayLike<number>): string | null {
  if (pixels.length !== 72) return null;
  let hex = "";
  for (let row = 0; row < 8; row += 1) {
    for (let half = 0; half < 2; half += 1) {
      let nibble = 0;
      for (let k = 0; k < 4; k += 1) {
        const col = half * 4 + k;
        nibble = (nibble << 1) | (pixels[row * 9 + col] > pixels[row * 9 + col + 1] ? 1 : 0);
      }
      hex += nibble.toString(16);
    }
  }
  return hex;
}

/** İki karma arası Hamming uzaklığı (0..64); biçim geçersizse null. */
export function hammingHex(a: string, b: string): number | null {
  if (!DHASH_RE.test(a) || !DHASH_RE.test(b)) return null;
  let n = 0;
  for (let i = 0; i < 16; i += 1) n += POP4[Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16)];
  return n;
}

/**
 * İki fotoğraf kümesi arası benzerlik 0..1: her çiftin en küçük Hamming uzaklığı alınır (en az 1 geçerli çift şart).
 * Hiç geçerli çift yoksa null (ölçülemedi).
 */
export function photoHashSimilarity(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): number | null {
  if (!a?.length || !b?.length) return null;
  let best: number | null = null;
  for (const x of a.slice(0, 12)) {
    for (const y of b.slice(0, 12)) {
      const d = hammingHex(x, y);
      if (d !== null && (best === null || d < best)) best = d;
    }
  }
  if (best === null) return null;
  if (best <= HAMMING_SAME) return 1;
  if (best >= HAMMING_DIFFERENT) return 0;
  return 1 - (best - HAMMING_SAME) / (HAMMING_DIFFERENT - HAMMING_SAME);
}
