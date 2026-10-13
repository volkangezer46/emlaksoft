/**
 * Gece yedeği durumu (SAF değerlendirme). Kaynak: `scripts/sunucu/backup-db.sh` başarılı yedekten sonra
 * platform_settings `ops.backup.last` anahtarına JSON yazar (uygulama konteyneri yedek dosyalarına/docker soketine
 * ERİŞMEZ; panel yalnız bu satırı okur). Kayıt yoksa "henüz yazılmadı" — sıfır/sahte değer gösterilmez.
 */

export const BACKUP_STATUS_KEY = "ops.backup.last";
export const BACKUP_HEARTBEAT_JOB = "yedek-gece";
export const BACKUP_MAX_AGE_HOURS = 26;

export type BackupRecord = {
  at: string;
  dbFile: string;
  sizeBytes: number;
  tables: number;
  encrypted: boolean;
  remote: boolean;
  storageObjects: number | null;
  archiveFiles: number | null;
  retentionDays: number;
};

export type BackupTone = "ok" | "warn" | "danger" | "none";
export type BackupIssue = { tone: "warn" | "danger"; title: string; action: string };

export type BackupEvaluation = {
  tone: BackupTone;
  record: BackupRecord | null;
  ageHours: number | null;
  issues: BackupIssue[];
  /** Kayıt yoksa/bozuksa gösterilecek metin. */
  emptyText: string | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

/** Ham JSON metnini doğrular; bozuk/eksikse null (asla fırlatmaz). */
export function parseBackupRecord(raw: string | null | undefined): BackupRecord | null {
  if (!raw) return null;
  let j: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    j = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const at = typeof j.at === "string" && !Number.isNaN(Date.parse(j.at)) ? j.at : null;
  if (!at) return null;
  return {
    at,
    dbFile: typeof j.dbFile === "string" ? j.dbFile.slice(0, 200) : "",
    sizeBytes: num(j.sizeBytes) ?? 0,
    tables: num(j.tables) ?? 0,
    encrypted: j.encrypted === true,
    remote: j.remote === true,
    storageObjects: num(j.storageObjects),
    archiveFiles: num(j.archiveFiles),
    retentionDays: num(j.retentionDays) ?? 0,
  };
}

export function evaluateBackup(raw: string | null | undefined, nowMs: number): BackupEvaluation {
  const record = parseBackupRecord(raw);
  if (!record) {
    return {
      tone: "none",
      record: null,
      ageHours: null,
      issues: [],
      emptyText: raw ? "Yedek kaydı okunamadı (bozuk biçim)." : "Yedek bilgisi henüz yazılmadı.",
    };
  }
  const ageHours = Math.max(0, (nowMs - Date.parse(record.at)) / 3_600_000);
  const issues: BackupIssue[] = [];
  if (ageHours > BACKUP_MAX_AGE_HOURS) {
    issues.push({
      tone: "danger",
      title: `Son yedek ${Math.floor(ageHours)} saat önce (eşik ${BACKUP_MAX_AGE_HOURS} saat)`,
      action: "Sunucuda /var/log/emlaksoft-backup.log günlüğüne bakın ve /etc/cron.d/emlaksoft-backup satırının çalıştığını doğrulayın.",
    });
  }
  if (!record.encrypted) {
    issues.push({
      tone: "danger",
      title: "Yedek şifresiz",
      action: "Sunucuda age kurun ve BACKUP_AGE_RECIPIENT (age1… açık anahtar) tanımlayın; gizli anahtar sunucuda tutulmaz.",
    });
  }
  if (!record.remote) {
    issues.push({
      tone: "danger",
      title: "Uzak kopya yok",
      action: "Yedekler yalnız bu sunucuda. BACKUP_REMOTE (Storage Box) tanımlayıp ssh anahtarını kurun.",
    });
  }
  if (record.storageObjects !== null && record.archiveFiles !== null && record.storageObjects !== record.archiveFiles) {
    issues.push({
      tone: "warn",
      title: `Dosya sayısı uyuşmuyor: storage.objects ${record.storageObjects}, arşiv ${record.archiveFiles}`,
      action: "Storage yedeği eksik/fazla olabilir; bir sonraki gece yedeğinde tekrar ederse arşivi açıp karşılaştırın.",
    });
  }
  const tone: BackupTone = issues.some((i) => i.tone === "danger") ? "danger" : issues.length > 0 ? "warn" : "ok";
  return { tone, record, ageHours, issues, emptyText: null };
}

export function formatBytesTr(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
