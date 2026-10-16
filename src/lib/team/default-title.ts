import { ROLE_LABELS } from "@/lib/role-labels";

/**
 * Davette unvan İSTEĞE BAĞLI (C25): boş bırakılırsa rolden türetilir. Saf; davet eylemi ve formların ipucu aynı
 * kuralı kullanır. Danışman için kartvizitte görünen yaygın unvan, diğer rollerde rol adı.
 */
export function defaultTitleForRole(role: string): string {
  if (role === "advisor") return "Gayrimenkul Danışmanı";
  return ROLE_LABELS[role] ?? "Gayrimenkul Danışmanı";
}

/** Girilen unvan boşsa rol varsayılanı (en çok 80 karakter kuralı çağıranda). */
export function resolveInviteTitle(title: string, role: string): string {
  const t = title.trim();
  return t || defaultTitleForRole(role);
}
