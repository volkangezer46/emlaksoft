import { Archive } from "lucide-react";
import { relativeTimeTR } from "@/lib/admin-format";
import { BACKUP_HEARTBEAT_JOB, evaluateBackup, formatBytesTr } from "@/lib/ops/backup-status";

/**
 * Sistem > Yedek kartı. Veri: `backup-db.sh`'nin platform_settings `ops.backup.last` satırı + `yedek-gece` nabzı.
 * Panel docker soketine/yedek dosyalarına bağlanmaz; "Şimdi yedek al" bilinçli olarak YOK (yedek yalnız sunucu cron'u).
 */
export function BackupCard({
  raw,
  heartbeat,
  nowMs,
}: {
  raw: string | null;
  heartbeat: { last_run_at: string; last_status: string; last_detail: string | null } | null;
  nowMs: number;
}) {
  const ev = evaluateBackup(raw, nowMs);
  const toneCls =
    ev.tone === "danger" ? "text-danger-600" : ev.tone === "warn" ? "text-amber-600" : ev.tone === "ok" ? "text-mint-600" : "text-text-muted";
  const toneText = ev.tone === "danger" ? "Dikkat gerekiyor" : ev.tone === "warn" ? "Uyarı var" : ev.tone === "ok" ? "Sağlıklı" : "Bilgi yok";
  const hbOk = heartbeat?.last_status === "ok";

  return (
    <section id="yedek" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
        <Archive className="h-4 w-4" /> Yedek
      </p>
      <h2 className="mt-1 font-display font-bold text-ink-950">Gece veritabanı ve dosya yedeği</h2>
      <p className={`mt-2 text-sm font-semibold ${toneCls}`}>{toneText}</p>

      {ev.record ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-text-muted">Son yedek</dt>
          <dd className="m-0 font-semibold text-ink-950">{relativeTimeTR(ev.record.at)}</dd>
          <dt className="text-text-muted">Boyut</dt>
          <dd className="m-0 font-semibold tabular-nums text-ink-950">{formatBytesTr(ev.record.sizeBytes)}</dd>
          <dt className="text-text-muted">Tablo verisi</dt>
          <dd className="m-0 font-semibold tabular-nums text-ink-950">{ev.record.tables.toLocaleString("tr-TR")}</dd>
          <dt className="text-text-muted">Şifreleme</dt>
          <dd className={`m-0 font-semibold ${ev.record.encrypted ? "text-mint-600" : "text-danger-600"}`}>{ev.record.encrypted ? "Şifreli (.age)" : "Şifresiz"}</dd>
          <dt className="text-text-muted">Uzak kopya</dt>
          <dd className={`m-0 font-semibold ${ev.record.remote ? "text-mint-600" : "text-danger-600"}`}>{ev.record.remote ? "Var" : "Yok"}</dd>
          <dt className="text-text-muted">Dosyalar (kayıt / arşiv)</dt>
          <dd className="m-0 font-semibold tabular-nums text-ink-950">
            {ev.record.storageObjects ?? "?"} / {ev.record.archiveFiles ?? "?"}
          </dd>
          <dt className="text-text-muted">Saklama</dt>
          <dd className="m-0 font-semibold text-ink-950">{ev.record.retentionDays} gün</dd>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-text-muted">{ev.emptyText} Gece yedeği (ya da sunucuda betiğin elle çalıştırılması) bu kartı doldurur.</p>
      )}

      {ev.issues.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {ev.issues.map((i) => (
            <li
              key={i.title}
              className={`rounded-[var(--radius-control)] border px-3 py-2 text-xs ${
                i.tone === "danger" ? "border-danger-500/30 bg-danger-500/8" : "border-amber-300/50 bg-amber-50"
              }`}
            >
              <p className={`font-semibold ${i.tone === "danger" ? "text-danger-600" : "text-amber-800"}`}>{i.title}</p>
              <p className="mt-0.5 text-text-muted">Ne yapmalı: {i.action}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 text-xs text-text-muted">
        Nabız ({BACKUP_HEARTBEAT_JOB}):{" "}
        {heartbeat ? (
          <span className={`font-semibold ${hbOk ? "text-mint-600" : "text-danger-600"}`}>
            {hbOk ? "başarılı" : "hata"} · {relativeTimeTR(heartbeat.last_run_at)}
          </span>
        ) : (
          <span className="font-semibold">henüz yazılmadı</span>
        )}
      </p>
    </section>
  );
}
