/** Denetim kaydına tam adres yazılmaz: "a***@alan.com". Saf fonksiyon. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
