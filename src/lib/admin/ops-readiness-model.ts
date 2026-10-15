/**
 * Operasyon hazırlık sinyalleri — SAF model (testli; istemci çipi de tipleri okur). Yükleyici `ops-readiness.ts`.
 * Kural: okunamayan alan (null) sinyal ÜRETMEZ (sahte uyarı yok); her sinyal tıklanınca sorunu çözdüğü ekrana gider.
 */
import { BACKUP_MAX_AGE_HOURS } from "@/lib/ops/backup-status";
import { DRILL_MAX_AGE_DAYS } from "@/lib/ops/restore-drill-status";

export const ALERTS_HREF = "/admin/sistem?sekme=uyarilar";
export const BACKUP_HREF = "/admin/sistem#yedek";

export type OpsReadiness = {
  /** Etkin uyarı kanalı (Telegram / webhook / e-posta) sayısı; null = okunamadı. */
  channels: number | null;
  criticalLast24h: number | null;
  /** Son 24 saatte açılıp HİÇBİR kanala iletilmemiş kritik uyarılar. */
  unnotifiedCritical24h: number | null;
  backup: { present: boolean; encrypted: boolean | null; remote: boolean | null; ageHours: number | null } | null;
  drill: { present: boolean; ok: boolean | null; ageDays: number | null } | null;
  emailEnabled: boolean | null;
  emailHref: string;
};

export type ReadinessSignal = {
  id: "alert-channels" | "critical-unnotified" | "backup-stale" | "backup-missing" | "backup-unsafe" | "drill-failed" | "drill-missing" | "drill-stale" | "email-off";
  label: string;
  hint: string;
  href: string;
  /** Dikkat kuyruğu sayacı (çoğu sinyal tekil: 1). */
  count: number;
  tone: "danger" | "warn";
  /** Dikkat kuyruğu sırası (buildAttentionQueue ile aynı ölçek; cron hatası 85). */
  severity: number;
};

/** Hazırlık verisinden sinyaller (önem sırasıyla). */
export function readinessSignals(r: OpsReadiness): ReadinessSignal[] {
  const out: ReadinessSignal[] = [];
  if (r.channels === 0) {
    out.push({
      id: "alert-channels",
      label: "Uyarı kanalı yok",
      hint: "Kesinti ve kritik uyarılar hiçbir kanala (Telegram / e-posta / webhook) gitmiyor; en az bir kanal ekleyin",
      href: ALERTS_HREF,
      count: 1,
      tone: "danger",
      severity: 88,
    });
  }
  if (r.unnotifiedCritical24h !== null && r.unnotifiedCritical24h > 0) {
    out.push({
      id: "critical-unnotified",
      label: `Son 24 sa ${r.unnotifiedCritical24h} kritik uyarı kimseye gitmedi`,
      hint: "Kritik olaylar yalnız zile düştü; kanal teslim günlüğüne bakın",
      href: ALERTS_HREF,
      count: r.unnotifiedCritical24h,
      tone: "danger",
      severity: 87,
    });
  }
  if (r.backup) {
    if (!r.backup.present) {
      out.push({ id: "backup-missing", label: "Yedek bilgisi yok", hint: "Gece yedeği durum kaydı yazılmadı", href: BACKUP_HREF, count: 1, tone: "warn", severity: 62 });
    } else {
      if (r.backup.ageHours !== null && r.backup.ageHours > BACKUP_MAX_AGE_HOURS) {
        out.push({
          id: "backup-stale",
          label: `Son yedek ${Math.floor(r.backup.ageHours)} saat önce`,
          hint: `Eşik ${BACKUP_MAX_AGE_HOURS} saat; gece yedeği çalışmıyor olabilir`,
          href: BACKUP_HREF,
          count: 1,
          tone: "danger",
          severity: 84,
        });
      }
      const unsafe = [r.backup.encrypted === false ? "şifresiz" : null, r.backup.remote === false ? "yalnız yerel" : null].filter(Boolean);
      if (unsafe.length > 0) {
        out.push({
          id: "backup-unsafe",
          label: `Yedek ${unsafe.join(" ve ")}`,
          hint: "Şifreleme açık anahtarı ve uzak kopya hedefi Ayar merkezi > Sağlık ve izleme'den girilir",
          href: BACKUP_HREF,
          count: 1,
          tone: "warn",
          severity: 72,
        });
      }
    }
  }
  if (r.drill) {
    if (r.drill.present && r.drill.ok === false) {
      out.push({ id: "drill-failed", label: "Geri yükleme tatbikatı başarısız", hint: "Son tatbikat yedeği geri yükleyemedi", href: BACKUP_HREF, count: 1, tone: "danger", severity: 82 });
    } else if (!r.drill.present) {
      out.push({ id: "drill-missing", label: "Geri yükleme tatbikatı yapılmadı", hint: "Yedeğin açılabildiği hiç doğrulanmadı", href: BACKUP_HREF, count: 1, tone: "warn", severity: 58 });
    } else if (r.drill.ageDays !== null && r.drill.ageDays > DRILL_MAX_AGE_DAYS) {
      out.push({
        id: "drill-stale",
        label: `Tatbikat ${Math.floor(r.drill.ageDays)} gündür yok`,
        hint: `Eşik ${DRILL_MAX_AGE_DAYS} gün`,
        href: BACKUP_HREF,
        count: 1,
        tone: "warn",
        severity: 58,
      });
    }
  }
  if (r.emailEnabled === false) {
    out.push({
      id: "email-off",
      label: "E-posta kanalı kapalı",
      hint: "Doğrulama, fatura ve KVKK e-postaları gitmiyor; Resend anahtarı ve gönderen alan adı gerekli",
      href: r.emailHref,
      count: 1,
      tone: "danger",
      severity: 79,
    });
  }
  return out.sort((a, b) => b.severity - a.severity);
}
