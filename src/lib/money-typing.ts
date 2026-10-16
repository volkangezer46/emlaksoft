import { parseMoneyInput } from "@/lib/money-input";

/**
 * Tutar alanı yazım biçimi (SAF; DOM yok). `MoneyInput` her tuşta bunu çağırır.
 *
 * Kural: Türkçe biçim — nokta binlik, virgül ondalık. Yazarken nokta her zaman binlik sayılır ve yeniden gruplanır
 * ("4100000" → "4.100.000", "4.100.0001" → "41.000.001"); ilk virgülden sonrası en çok 2 hane kuruştur. Harf, sembol ve
 * ikinci virgül atılır. Boş giriş boş kalır. Yapıştırma (`normalizeMoneyPaste`) ayrıca "1250.50" gibi İngilizce biçimi de tanır.
 *
 * Eski desen `type="number" min="1" step="1000"` idi: tarayıcı yalnız 1, 1001, 2001… değerlerini kabul ettiği için
 * "4.100.000" gibi yuvarlak teklif tutarları "Geçerli bir değer girin" ile reddediliyordu; "4.800.000" yazınca "4.800000" oluyordu.
 */
export function formatMoneyTyping(raw: string, decimals = 2): string {
  const s = String(raw ?? "").replace(/[^\d,]/g, "");
  if (!s) return "";
  const comma = s.indexOf(",");
  const wholeRaw = comma === -1 ? s : s.slice(0, comma);
  const fraction = comma === -1 ? null : s.slice(comma + 1).replace(/,/g, "").slice(0, decimals);
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  const grouped = (whole || (fraction != null ? "0" : "")).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return fraction != null && decimals > 0 ? `${grouped},${fraction}` : grouped;
}

/** İmleç konumu: biçimlemeden önce imleçten önceki rakam/virgül sayısı korunur (ortada düzeltme yaparken imleç kaçmaz). */
export function caretAfterFormat(prevRaw: string, prevCaret: number, next: string): number {
  const significant = prevRaw.slice(0, Math.max(0, prevCaret)).replace(/[^\d,]/g, "").length;
  if (significant === 0) return 0;
  let seen = 0;
  for (let i = 0; i < next.length; i++) {
    if (/[\d,]/.test(next[i])) seen += 1;
    if (seen === significant) return i + 1;
  }
  return next.length;
}

/** Yapıştırılan metin: "1250.50", "₺1.250,50", "1,250.50", "4.100.000 TL" → Türkçe yazım biçimi. Çözülemezse yazım kuralı uygulanır. */
export function normalizeMoneyPaste(text: string, decimals = 2): string {
  const parsed = parseMoneyInput(text, { allowZero: true });
  if (parsed.ok && parsed.value != null) return formatMoneyValue(parsed.value, decimals);
  return formatMoneyTyping(text, decimals);
}

/** Sayı → alan metni: 4100000 → "4.100.000", 1250.5 → "1.250,5" (gereksiz kuruş sıfırı eklenmez). */
export function formatMoneyValue(value: number | string | null | undefined, decimals = 2): string {
  if (value == null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return formatMoneyTyping(String(value), decimals);
  const scale = 10 ** decimals;
  const rounded = Math.round(n * scale) / scale;
  const [whole, frac] = String(Math.abs(rounded)).split(".");
  return formatMoneyTyping(frac ? `${whole},${frac}` : whole, decimals);
}

/** Alan metni → sayı (boş/geçersiz → null). İstemcide karşı teklif gibi doğrudan sayı isteyen çağrılar için. */
export function moneyTextToNumber(text: string): number | null {
  const parsed = parseMoneyInput(text, { allowZero: true });
  return parsed.ok ? parsed.value : null;
}
