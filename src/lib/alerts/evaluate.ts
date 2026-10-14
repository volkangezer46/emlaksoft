import { CRON_JOBS } from "@/lib/cron-jobs";
import { evaluateCronHealth, type HeartbeatRow } from "@/lib/cron-staleness";
import { parseBackupRecord } from "@/lib/ops/backup-status";
import { platformKvkkDaysLeft } from "@/lib/compliance/platform-kvkk";
import type { AlertRuleConfig, AlertRuleKey, AlertSeverity } from "./rules";
import { ALERT_RULES } from "./rules";

/**
 * Uygulama içi uyarı değerlendirmesi (SAF; DB yok, test edilir). Girdi bir anlık görüntüdür; çıktı ŞU AN tetiklenen
 * koşullar + bu turda değerlendirilebilen kurallardır. Verisi olmayan kural (ör. tablo yok, ölçüm yok) değerlendirilmiş
 * SAYILMAZ: o kuralın açık olayı "düzeldi" diye kapatılmaz (veri yokluğu düzelme değildir).
 */

export type AlertCondition = {
  ruleKey: AlertRuleKey;
  fingerprint: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  href: string;
};

export type AlertSnapshot = {
  nowMs: number;
  /** cron_heartbeats satırları; null = okunamadı. */
  heartbeats: readonly HeartbeatRow[] | null;
  /** Duraklatılan işler (gecikme/hata uyarısı üretmez). */
  pausedJobs: ReadonlySet<string>;
  /** Son 5 dakikadaki hata olayı sayısı; null = sayaç yok. */
  errorsLast5m: number | null;
  /** platform_settings `ops.backup.last` ham değeri + `yedek-gece` nabzı; null = okunamadı. */
  backup: { raw: string | null; heartbeat: { last_status: string | null; last_run_at: string | null; last_detail?: string | null } | null } | null;
  /** En son sunucu ölçümü; null = ölçüm yok. */
  disk: { host: string; pct: number; at: string } | null;
  /** Elle inceleme/iade bekleyen ödeme yakalama kaydı sayısı; null = okunamadı. */
  captureProblems: number | null;
  /** Son günlük MRR ve 7 gün önceki; null = yeterli anlık görüntü yok. */
  mrr: { latest: number; latestDay: string; previous: number; previousDay: string } | null;
  /** Yanıtlanmamış (açık) platform KVKK başvurularının son tarihleri; null = tablo yok / okunamadı (değerlendirilmez). */
  kvkkOpen?: readonly { ref: string; due_at: string | null }[] | null;
};

/** Ölçüm bu kadar eskiyse disk kuralı değerlendirilmez (betik durmuş olabilir; ayrıca "ölçüm bayat" denir). */
export const HOST_METRIC_STALE_MINUTES = 15;

const jobLabel = new Map<string, string>(CRON_JOBS.map((j) => [j.job, j.label]));

const pct = (n: number) => `%${n.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;

export function evaluateAlerts(
  s: AlertSnapshot,
  rules: Record<AlertRuleKey, AlertRuleConfig>,
): { firing: AlertCondition[]; evaluated: Set<AlertRuleKey> } {
  const firing: AlertCondition[] = [];
  const evaluated = new Set<AlertRuleKey>();
  const on = (k: AlertRuleKey) => rules[k].enabled;
  const sev = (k: AlertRuleKey) => ALERT_RULES[k].severity;

  // Cron gecikmesi / hatası
  if (s.heartbeats) {
    const problems = evaluateCronHealth(s.heartbeats, s.nowMs).filter((p) => !s.pausedJobs.has(p.job));
    evaluated.add("cron_late");
    evaluated.add("cron_error");
    for (const p of problems) {
      const label = jobLabel.get(p.job) ?? p.job;
      if (p.reason === "error" && on("cron_error")) {
        const hb = s.heartbeats.find((h) => h.job === p.job) as (HeartbeatRow & { last_detail?: string | null }) | undefined;
        firing.push({
          ruleKey: "cron_error",
          fingerprint: `cron_error:${p.job}`,
          severity: sev("cron_error"),
          title: `Cron hata verdi: ${label}`,
          body: `${p.job} son çalışmasında hata verdi${hb?.last_detail ? `: ${hb.last_detail.slice(0, 300)}` : "."}`,
          href: `/admin/sistem?is=${encodeURIComponent(p.job)}#cron-${p.job}`,
        });
      } else if (p.reason !== "error" && on("cron_late")) {
        firing.push({
          ruleKey: "cron_late",
          fingerprint: `cron_late:${p.job}`,
          severity: sev("cron_late"),
          title: `Cron gecikti: ${label}`,
          body:
            p.reason === "never_ran"
              ? `${p.job} hiç çalışmadı (pencere ${p.staleAfterMinutes} dk).`
              : `${p.job} ${p.minutesSinceRun} dakikadır çalışmadı (pencere ${p.staleAfterMinutes} dk).`,
          href: `/admin/sistem?is=${encodeURIComponent(p.job)}#cron-${p.job}`,
        });
      }
    }
  }

  // Hata patlaması
  if (s.errorsLast5m !== null) {
    evaluated.add("error_burst");
    const limit = rules.error_burst.threshold ?? 20;
    if (on("error_burst") && s.errorsLast5m >= limit) {
      firing.push({
        ruleKey: "error_burst",
        fingerprint: "error_burst",
        severity: sev("error_burst"),
        title: `Hata patlaması: 5 dakikada ${s.errorsLast5m} olay`,
        body: `Son 5 dakikada ${s.errorsLast5m} hata olayı kaydedildi (eşik ${limit}).`,
        href: "/admin/sistem?sekme=hatalar&son=1saat",
      });
    }
  }

  // Yedek
  if (s.backup) {
    evaluated.add("backup_failed");
    const maxHours = rules.backup_failed.threshold ?? 26;
    const record = parseBackupRecord(s.backup.raw);
    const hbFailed = s.backup.heartbeat?.last_status === "error";
    const ageHours = record ? Math.max(0, (s.nowMs - Date.parse(record.at)) / 3_600_000) : null;
    let reason: string | null = null;
    if (hbFailed) reason = `Son gece yedeği hata verdi${s.backup.heartbeat?.last_detail ? `: ${s.backup.heartbeat.last_detail.slice(0, 200)}` : "."}`;
    else if (!record) reason = "Başarılı yedek kaydı yok (ops.backup.last yazılmamış).";
    else if (ageHours !== null && ageHours > maxHours) reason = `Son başarılı yedek ${Math.floor(ageHours)} saat önce (eşik ${maxHours} saat).`;
    if (reason && on("backup_failed")) {
      firing.push({
        ruleKey: "backup_failed",
        fingerprint: "backup_failed",
        severity: sev("backup_failed"),
        title: hbFailed ? "Yedek başarısız" : "Yedek bayat",
        body: reason,
        href: "/admin/sistem#yedek",
      });
    }
  }

  // Disk
  if (s.disk) {
    const age = (s.nowMs - Date.parse(s.disk.at)) / 60_000;
    if (Number.isFinite(age) && age <= HOST_METRIC_STALE_MINUTES) {
      evaluated.add("disk_usage");
      const limit = rules.disk_usage.threshold ?? 85;
      if (on("disk_usage") && s.disk.pct >= limit) {
        firing.push({
          ruleKey: "disk_usage",
          fingerprint: `disk_usage:${s.disk.host}`,
          severity: sev("disk_usage"),
          title: `Disk ${pct(s.disk.pct)} dolu (${s.disk.host})`,
          body: `Sunucu disk kullanımı ${pct(s.disk.pct)}; eşik ${pct(limit)}.`,
          href: "/admin/sistem?sekme=kaynaklar",
        });
      }
    }
  }

  // Ödeme yakalama
  if (s.captureProblems !== null) {
    evaluated.add("payment_capture");
    const limit = rules.payment_capture.threshold ?? 1;
    if (on("payment_capture") && s.captureProblems >= limit) {
      firing.push({
        ruleKey: "payment_capture",
        fingerprint: "payment_capture",
        severity: sev("payment_capture"),
        title: `Ödeme yakalama sorunu: ${s.captureProblems} kayıt`,
        body: `${s.captureProblems} ödeme yakalama kaydı elle inceleme ya da iade bekliyor.`,
        href: "/admin/billing",
      });
    }
  }

  // MRR düşüşü
  if (s.mrr) {
    evaluated.add("mrr_drop");
    const limit = rules.mrr_drop.threshold ?? 10;
    if (s.mrr.previous > 0) {
      const dropPct = ((s.mrr.previous - s.mrr.latest) / s.mrr.previous) * 100;
      if (on("mrr_drop") && dropPct >= limit) {
        firing.push({
          ruleKey: "mrr_drop",
          fingerprint: "mrr_drop",
          severity: sev("mrr_drop"),
          title: `MRR ${pct(dropPct)} düştü`,
          body: `MRR ${s.mrr.previousDay}: ${Math.round(s.mrr.previous).toLocaleString("tr-TR")} TL → ${s.mrr.latestDay}: ${Math.round(s.mrr.latest).toLocaleString("tr-TR")} TL (eşik ${pct(limit)}).`,
          href: "/admin/raporlar",
        });
      }
    }
  }

  // KVKK başvuru süresi (DG6): gecikmiş ve eşik içindeki açık başvurular ayrı olaylardır (gecikme ayrıca bildirilir).
  if (s.kvkkOpen) {
    evaluated.add("kvkk_sla");
    const warnDays = rules.kvkk_sla.threshold ?? 3;
    const days = s.kvkkOpen.map((r) => ({ ref: r.ref, left: platformKvkkDaysLeft(r.due_at, "open", s.nowMs) })).filter((r) => r.left !== null) as { ref: string; left: number }[];
    const late = days.filter((d) => d.left < 0).sort((a, b) => a.left - b.left);
    const soon = days.filter((d) => d.left >= 0 && d.left <= warnDays);
    if (on("kvkk_sla") && late.length > 0) {
      firing.push({
        ruleKey: "kvkk_sla",
        fingerprint: "kvkk_sla:late",
        severity: "critical",
        title: `KVKK yanıt süresi geçti: ${late.length} başvuru`,
        body: `${late.length} KVKK başvurusu 30 günlük yasal süreyi aştı (en eski ${late[0]!.ref}, ${Math.abs(late[0]!.left)} gün gecikti).`,
        href: "/admin/tickets/kvkk?kaynak=basvuru&sure=gecikmis",
      });
    }
    if (on("kvkk_sla") && soon.length > 0) {
      firing.push({
        ruleKey: "kvkk_sla",
        fingerprint: "kvkk_sla:warn",
        severity: sev("kvkk_sla"),
        title: `KVKK yanıt süresi yaklaşıyor: ${soon.length} başvuru`,
        body: `${soon.length} KVKK başvurusunun yanıt süresinin dolmasına ${warnDays} gün ya da daha az kaldı.`,
        href: "/admin/tickets/kvkk?kaynak=basvuru&sure=yaklasan",
      });
    }
  }

  return { firing, evaluated };
}

/** Bildirim metni (düz metin; Telegram/e-posta/webhook ortak). */
export function formatAlertText(
  c: Pick<AlertCondition, "title" | "body" | "href">,
  state: "firing" | "resolved" | "reminder" | "test",
  baseUrl: string,
): { subject: string; text: string } {
  const prefix = state === "resolved" ? "[DÜZELDİ]" : state === "test" ? "[DENEME]" : state === "reminder" ? "[SÜRÜYOR]" : "[UYARI]";
  const subject = `${prefix} ${c.title}`.slice(0, 200);
  const link = c.href ? `${baseUrl.replace(/\/$/, "")}${c.href}` : "";
  const text = [subject, "", c.body, link ? `\n${link}` : ""].join("\n").trim().slice(0, 3500);
  return { subject, text };
}

/** `cron_late:<iş>` / `cron_error:<iş>` olayı duraklatılmış bir işe mi ait? */
export function isPausedJobEvent(fingerprint: string, pausedJobs: ReadonlySet<string>): boolean {
  const m = /^cron_(?:late|error):(.+)$/.exec(fingerprint);
  return Boolean(m && pausedJobs.has(m[1]!));
}
