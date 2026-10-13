/**
 * AD11 yedek ayarları (SAF). Değerler platform_settings'te; `scripts/sunucu/backup-db.sh` başlangıçta psql ile okur
 * (ortam değişkeni BACKUP_AGE_RECIPIENT / BACKUP_REMOTE tanımlıysa o önceliklidir). Betik aynı biçim kurallarını
 * yeniden uygular (değer komut satırına seçenek olarak sızamaz).
 */
export const BACKUP_AGE_RECIPIENT_KEY = "ops.backup.age_recipient";
export const BACKUP_REMOTE_KIND_KEY = "ops.backup.remote_kind";
export const BACKUP_REMOTE_TARGET_KEY = "ops.backup.remote_target";
export const BACKUP_REMOTE_PORT_KEY = "ops.backup.remote_port";
export const RESTORE_DRILL_WEEKDAY_KEY = "ops.restore_drill.weekday";
export const RESTORE_DRILL_STATUS_KEY = "ops.restore_drill.last";
export const RESTORE_DRILL_HEARTBEAT_JOB = "geri-yukleme-tatbikati";

export const AGE_RECIPIENT_RE = /^age1[02-9ac-hj-np-z]{58}$/;
/** Storage Box (rsync/ssh): kullanici@host:yol */
export const SSH_TARGET_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]*$/;
/** rclone: uzak-ad:yol */
export const RCLONE_TARGET_RE = /^[A-Za-z0-9_-]+:[A-Za-z0-9._/-]*$/;

export function validateAgeRecipient(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  return AGE_RECIPIENT_RE.test(s) ? null : "age açık anahtarı 'age1' ile başlayan 62 karakterlik değer olmalı (gizli anahtar DEĞİL).";
}

export function validateRemoteTarget(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (s.startsWith("-")) return "Hedef '-' ile başlayamaz.";
  return SSH_TARGET_RE.test(s) || RCLONE_TARGET_RE.test(s)
    ? null
    : "Hedef biçimi: kullanici@host:klasor (Storage Box) ya da uzak-ad:yol (rclone). Boşluk ve özel karakter kullanılamaz.";
}
