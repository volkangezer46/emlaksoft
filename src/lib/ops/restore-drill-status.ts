/**
 * Haftalık geri yükleme tatbikatı durumu (SAF). Kaynak: `scripts/sunucu/restore-drill.sh` sonucu platform_settings
 * `ops.restore_drill.last` (JSON) + `restore_drills` tablosu + `geri-yukleme-tatbikati` nabzı. Kayıt yoksa
 * "henüz yapılmadı" — sahte değer gösterilmez.
 */
export const DRILL_MAX_AGE_DAYS = 8;

export type DrillRecord = {
  at: string;
  ok: boolean;
  durationSec: number | null;
  backupFile: string;
  tablesChecked: number | null;
  restoreErrors: number | null;
  mismatches: string[];
  detail: string;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

export function parseDrillRecord(raw: string | null | undefined): DrillRecord | null {
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
    ok: j.status === "ok",
    durationSec: num(j.durationSec),
    backupFile: typeof j.backupFile === "string" ? j.backupFile.slice(0, 200) : "",
    tablesChecked: num(j.tablesChecked),
    restoreErrors: num(j.restoreErrors),
    mismatches: Array.isArray(j.mismatches) ? j.mismatches.filter((m): m is string => typeof m === "string").slice(0, 20) : [],
    detail: typeof j.detail === "string" ? j.detail.slice(0, 300) : "",
  };
}

export type DrillEvaluation = { tone: "ok" | "warn" | "danger" | "none"; record: DrillRecord | null; ageDays: number | null; text: string };

export function evaluateDrill(raw: string | null | undefined, nowMs: number): DrillEvaluation {
  const record = parseDrillRecord(raw);
  if (!record) return { tone: "none", record: null, ageDays: null, text: raw ? "Tatbikat kaydı okunamadı (bozuk biçim)." : "Geri yükleme tatbikatı henüz yapılmadı." };
  const ageDays = Math.max(0, (nowMs - Date.parse(record.at)) / 86_400_000);
  if (!record.ok) return { tone: "danger", record, ageDays, text: `Son tatbikat BAŞARISIZ${record.detail ? `: ${record.detail}` : ""}` };
  if (ageDays > DRILL_MAX_AGE_DAYS) return { tone: "warn", record, ageDays, text: `Son başarılı tatbikat ${Math.floor(ageDays)} gün önce (eşik ${DRILL_MAX_AGE_DAYS} gün).` };
  return { tone: "ok", record, ageDays, text: "Son tatbikat başarılı." };
}

export function formatDurationTr(sec: number | null): string {
  if (sec === null) return "?";
  if (sec < 60) return `${sec} sn`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} dk ${s} sn` : `${m} dk`;
}
