import type { EmailTemplateDef } from "@/lib/email/templates";

/**
 * Şablon rozeti (SAF, B117): akışa bağlı şablon kanal KAPALIYKEN "Kullanımda" değil "Kanal kapalı: gitmiyor" (kırmızı)
 * görünür (eskiden yalnız statik `usedBy` metnine bakıyordu: KVKK doğrulama "Kullanımda" yazıp hiç gitmiyordu).
 * Kimlik doğrulama (auth) e-postalarını GoTrue gönderir; Resend kanalından bağımsızdır.
 */
export type TemplateBadge = { label: string; variant: "success" | "neutral" | "danger" };

export function templateBadge(t: Pick<EmailTemplateDef, "usedBy" | "group">, channelEnabled: boolean): TemplateBadge {
  const wired = !t.usedBy.startsWith("Henüz");
  if (!wired) return { label: "Akış bekliyor", variant: "neutral" };
  if (!channelEnabled && t.group !== "auth") return { label: "Kanal kapalı: gitmiyor", variant: "danger" };
  return { label: "Kullanımda", variant: "success" };
}
