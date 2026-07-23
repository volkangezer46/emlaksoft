/** Admin panel ortak biçimlendirme yardımcıları (saf, yan etkisiz). */

export function moneyTRY(n: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

export function greetingTR(): string {
  const hour = Number(
    new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", hour12: false, timeZone: "Europe/Istanbul" }).format(new Date()),
  );
  if (hour < 6) return "İyi geceler";
  if (hour < 12) return "Günaydın";
  if (hour < 18) return "İyi günler";
  return "İyi akşamlar";
}

export function todayTR(): string {
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Istanbul",
  }).format(new Date());
}

/** ISO tarih dizisinden son N haftalık sayım kovaları üretir. */
export function weekBuckets(dates: (string | null | undefined)[], weeks = 8): number[] {
  const weekMs = 7 * 86_400_000;
  const nowMs = Date.now();
  const buckets = Array.from({ length: weeks }, () => 0);
  for (const d of dates) {
    if (!d) continue;
    const idx = weeks - 1 - Math.floor((nowMs - new Date(d).getTime()) / weekMs);
    if (idx >= 0 && idx < weeks) buckets[idx] += 1;
  }
  return buckets;
}

/** audit_logs ve platform_audit_logs.action için insana okunur etiket. */
export function auditActionLabel(action: string): string {
  const map: Record<string, string> = {
    // Tenant / ops
    "ops.impersonate.start":    "Ofise giriş yapıldı",
    "ops.impersonate.stop":     "Ofisten çıkıldı",
    "tenant.create":            "Ofis oluşturuldu",
    "tenant.update":            "Ofis güncellendi",
    "subscription.update":      "Abonelik güncellendi",
    "ticket.create":            "Destek talebi açıldı",
    "ticket.reply":             "Destek talebi yanıtlandı",
    "ticket.status":            "Destek talebi durumu değişti",
    "demo.request":             "Yeni demo talebi geldi",
    "sales.status":             "Aday durumu güncellendi",
    "sales.assign":             "Aday atandı",
    "sales.convert":            "Aday ofise dönüştürüldü",
    // Platform personel
    "platform_staff.add":         "Personel eklendi",
    "platform_staff.invite":      "Personel davet edildi",
    "platform_staff.role_change": "Personel rolü değiştirildi",
    "platform_staff.deactivate":  "Personel pasif yapıldı",
    "platform_staff.reactivate":  "Personel tekrar aktif edildi",
    // Entegrasyon anahtarları
    "integration.endeksa.save":   "Endeksa anahtarı kaydedildi",
    "integration.endeksa.clear":  "Endeksa anahtarı silindi",
    "integration.tapusor.save":   "Tapusor anahtarı kaydedildi",
    "integration.tapusor.clear":  "Tapusor anahtarı silindi",
  };
  if (map[action]) return map[action];
  // Fallback: "customer.create" → "customer · create"
  return action.replace(/\./g, " · ");
}

export function relativeTimeTR(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}
