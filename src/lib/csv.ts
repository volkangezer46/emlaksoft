const PLAIN_NUMERIC_STRING = /^[+-]?[\d.,]+$/;

/** Elektronik tablo formül enjeksiyonuna dayanıklı tek CSV hücresi üretir. */
export function escapeCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);

  // Excel ve Sheets baştaki boşlukları atladıktan sonra bu karakterlerle
  // başlayan kullanıcı metinlerini formül olarak yorumlayabilir. Gerçek `number`
  // değerler hiç dokunulmadan geçer (aşağıdaki `typeof value === "string"` kapısı).
  // AMA PostgREST `numeric` kolonları hassasiyeti korumak için JSON'da STRING
  // döner (ör. "-250.00") — bu yüzden düz sayısal metinler (işaret dahil) de
  // formül sanılmamalı, aksi halde negatif tutarlar dışa aktarımda metin
  // hücresine döner (bkz. csv.test.ts).
  const isPlainNumericString = typeof value === "string" && PLAIN_NUMERIC_STRING.test(text.trim());

  if (typeof value === "string" && !isPlainNumericString && (/^[\t\r\n]/.test(text) || /^\s*[=+\-@]/.test(text))) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}
