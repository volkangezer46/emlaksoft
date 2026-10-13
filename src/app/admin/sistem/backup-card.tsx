import { Suspense } from "react";
import { Archive, History, RotateCcw } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { relativeTimeTR } from "@/lib/admin-format";
import { BACKUP_HEARTBEAT_JOB, evaluateBackup, formatBytesTr } from "@/lib/ops/backup-status";
import { RESTORE_DRILL_STATUS_KEY } from "@/lib/ops/backup-settings";
import { evaluateDrill, formatDurationTr } from "@/lib/ops/restore-drill-status";
import { createAdminClient } from "@/lib/supabase/admin";

const DATE = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" });
const SETTINGS_HREF = "/admin/ayarlar/merkez?ara=ops.backup";

type RunRow = { id: number; finished_at: string; status: string; db_file: string | null; size_bytes: number | null; encrypted: boolean; remote: boolean };

/**
 * AD11 yedek geçmişi + son geri yükleme tatbikatı (akışla gelir; kartın üst kısmını bekletmez). Kaynak: backup_runs,
 * platform_settings `ops.restore_drill.last` (scripts/sunucu/restore-drill.sh). Tablo yoksa "kurulum bekliyor".
 */
async function BackupHistory({ nowMs }: { nowMs: number }) {
  const admin = createAdminClient();
  const [runs, drillRow] = await Promise.all([
    admin.from("backup_runs").select("id, finished_at, status, db_file, size_bytes, encrypted, remote").order("finished_at", { ascending: false }).limit(10),
    admin.from("platform_settings").select("value").eq("key", RESTORE_DRILL_STATUS_KEY).maybeSingle(),
  ]);
  const drill = evaluateDrill((drillRow.data?.value as string | null) ?? null, nowMs);
  const drillCls =
    drill.tone === "danger" ? "text-danger-600" : drill.tone === "warn" ? "text-amber-700" : drill.tone === "ok" ? "text-mint-600" : "text-text-muted";
  const rows = (runs.data ?? []) as RunRow[];

  return (
    <>
      <div className="mt-4 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-900">
          <RotateCcw className="h-3.5 w-3.5 text-brand-600" aria-hidden /> Haftalık geri yükleme tatbikatı
        </p>
        <p className={`mt-1 text-sm font-semibold ${drillCls}`}>{drill.text}</p>
        {drill.record ? (
          <p className="mt-0.5 text-xs text-text-muted">
            {DATE.format(new Date(drill.record.at))} · süre {formatDurationTr(drill.record.durationSec)} · {drill.record.tablesChecked ?? "?"} tablo
            {drill.record.backupFile ? ` · ${drill.record.backupFile}` : ""}
            {drill.record.mismatches.length ? ` · ${drill.record.mismatches.join("; ")}` : ""}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-text-muted">Tatbikat günü gece yedeğinden sonra çalışır (gün: ayarlar). Elle: bash scripts/sunucu/restore-drill.sh &lt;dump&gt;.</p>
        )}
      </div>

      <div className="mt-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-900">
          <History className="h-3.5 w-3.5 text-brand-600" aria-hidden /> Son yedekler
        </p>
        {runs.error ? (
          <p className="mt-1 text-xs text-text-muted">Yedek geçmişi veritabanı güncellemesinden sonra tutulmaya başlar.</p>
        ) : rows.length === 0 ? (
          <p className="mt-1 text-xs text-text-muted">Henüz kayıtlı yedek koşusu yok; ilk gece yedeğinden sonra listelenir.</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-line rounded-[var(--radius-control)] border border-line text-xs">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                <span className="font-semibold text-ink-950">{DATE.format(new Date(r.finished_at))}</span>
                <span className="tabular-nums text-text-muted">{r.size_bytes !== null ? formatBytesTr(r.size_bytes) : "—"}</span>
                <span className={r.encrypted ? "text-mint-600" : "text-danger-600"}>{r.encrypted ? "şifreli" : "şifresiz"}</span>
                <span className={r.remote ? "text-mint-600" : "text-danger-600"}>{r.remote ? "uzakta" : "yalnız yerel"}</span>
                <span className={r.status === "ok" ? "text-mint-600" : "font-semibold text-danger-600"}>
                  {r.status === "ok" ? "tamam" : r.status === "partial" ? "kısmi" : "hata"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * Sistem > Yedek kartı. Veri: `backup-db.sh`'nin platform_settings `ops.backup.last` satırı + `yedek-gece` nabzı;
 * AD11 ile yedek geçmişi (backup_runs) ve haftalık geri yükleme tatbikatı. Şifreleme anahtarı (age açık anahtarı) ve
 * uzak hedef Sistem Ayarları Merkezi'nden girilir; betik bir sonraki gece okur.
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
        <p className="mt-1 text-xs font-semibold text-ink-900">
          Şifreli + uzak kopya: {ev.record.encrypted && ev.record.remote ? <span className="text-mint-600">evet</span> : <span className="text-danger-600">hayır</span>}
        </p>
      ) : null}

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

      <Suspense fallback={<div className="mt-4 h-24 animate-pulse rounded-[var(--radius-card)] bg-ink-950/8" aria-busy />}>
        <BackupHistory nowMs={nowMs} />
      </Suspense>

      <p className="mt-3 text-xs text-text-muted">
        <Link href={SETTINGS_HREF} className="font-semibold text-brand-600 hover:underline">
          Şifreleme anahtarı, uzak hedef ve tatbikat günü
        </Link>
        {" · "}
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
