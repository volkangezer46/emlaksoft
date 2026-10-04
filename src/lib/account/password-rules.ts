export const MIN_PASSWORD_LENGTH = 8;

/** Parola değiştirme girdisini doğrular; hata mesajı ya da null (geçerli) döner. */
export function validateNewPassword(input: { current: string; next: string; confirm: string }): string | null {
  if (!input.current) return "Mevcut parolanızı girin.";
  if (input.next.length < MIN_PASSWORD_LENGTH) return `Yeni parola en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`;
  if (input.next.length > 128) return "Yeni parola en fazla 128 karakter olabilir.";
  if (input.next === input.current) return "Yeni parola mevcut paroladan farklı olmalı.";
  if (input.next !== input.confirm) return "Yeni parola ve tekrarı eşleşmiyor.";
  return null;
}
