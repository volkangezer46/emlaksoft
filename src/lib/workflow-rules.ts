import { MANAGEMENT_TIER_ROLES, type TeamRole } from "@/lib/team/assignable-roles";

/**
 * Saf iş kuralları (sunucu eylemleri ve testler ortak kullanır; veritabanı/ağ yok).
 * Eylemler bu karar fonksiyonlarını çağırır, böylece kural tek yerde ve testlidir.
 */

/** Başkası adına randevu açma / danışman değiştirme: yalnız yönetim katmanı. */
export function canAssignOthers(role: string): boolean {
  return MANAGEMENT_TIER_ROLES.includes(role as TeamRole);
}

/** İstenen danışman boşsa ya da kendisiyse atama serbest; başkasıysa yetki gerekir. */
export function advisorAssignmentDecision(
  role: string,
  requested: string,
  fallback: string,
): { kind: "self"; advisorId: string } | { kind: "other"; advisorId: string } | { kind: "denied" } {
  if (!requested || requested === fallback) return { kind: "self", advisorId: fallback };
  return canAssignOthers(role) ? { kind: "other", advisorId: requested } : { kind: "denied" };
}

/** Ödeme linki iptali: yalnız açık ve ödemesi yakalanmamış link; zaten iptalse idempotent başarı. */
export function paymentLinkCancelDecision(
  status: string,
  hasCapture: boolean,
): "already_cancelled" | "not_open" | "captured" | "cancel" {
  if (status === "cancelled") return "already_cancelled";
  if (status !== "open") return "not_open";
  if (hasCapture) return "captured";
  return "cancel";
}

/** Link süresi uzatma gün sayısı: 1-30 tam sayı. */
export function normalizeExtendDays(days: unknown): number | null {
  const d = Math.trunc(Number(days));
  return Number.isFinite(d) && d >= 1 && d <= 30 ? d : null;
}

export type RentalExtensionCheck = { ok: true; noop?: boolean } | { ok: false; error: string };

/** Kira uzatma: yeni bitiş başlangıçtan ve mevcut bitişten sonra olmalı; boş = süresiz. */
export function checkRentalExtension(input: {
  status: string;
  startDate: string;
  currentEnd: string | null;
  newEnd: string | null;
}): RentalExtensionCheck {
  if (input.status !== "active") {
    return { ok: false, error: "Yalnızca aktif kira uzatılabilir; sonlanmış kira için yeni kira kaydı açın." };
  }
  if (input.newEnd) {
    if (input.newEnd <= input.startDate) return { ok: false, error: "Bitiş tarihi başlangıçtan sonra olmalı." };
    if (input.currentEnd && input.newEnd <= input.currentEnd) {
      return { ok: false, error: "Yeni bitiş tarihi mevcut bitiş tarihinden sonra olmalı." };
    }
    return { ok: true };
  }
  return input.currentEnd ? { ok: true } : { ok: true, noop: true };
}

/** Kira düzenleme alan doğrulaması (vade günü 1-28, bitiş başlangıçtan sonra). */
export function checkRentalEdit(input: {
  dueDay: number;
  startDate: string;
  endDate: string | null;
}): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 28) {
    return { ok: false, error: "Vade günü 1-28 arasında olmalı." };
  }
  if (input.endDate && input.endDate <= input.startDate) {
    return { ok: false, error: "Bitiş tarihi başlangıçtan sonra olmalı." };
  }
  return { ok: true };
}

/** Anlaşmaya portföy/müşteri bağlama: kazanılmış anlaşmada bağ değişmez; değişiklik yoksa işlem yok. */
export function dealLinkDecision(input: {
  stage: string;
  current: { propertyId: string | null; customerId: string | null };
  next: { propertyId?: string | null; customerId?: string | null };
}): "locked" | "noop" | "update" {
  if (input.stage === "won") return "locked";
  const propChanged =
    input.next.propertyId !== undefined && (input.current.propertyId ?? "") !== (input.next.propertyId ?? "");
  const custChanged =
    input.next.customerId !== undefined && (input.current.customerId ?? "") !== (input.next.customerId ?? "");
  return propChanged || custChanged ? "update" : "noop";
}
