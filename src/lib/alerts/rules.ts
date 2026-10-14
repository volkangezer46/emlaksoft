/**
 * Uyarı kuralları (SAF; DB yok). Anahtar listesi `alert_rules.key` CHECK kısıtıyla aynıdır
 * (supabase/migrations/20261013004900_ops_alerts.sql; `kvkk_sla` 20261014006000_platform_kvkk_requests.sql,
 * `engine_stalled` 20261014022000_alert_engine_pulse_rule.sql ile eklenir). Varsayılanlar migration'daki tohum satırlarıyla
 * aynıdır; tablo yoksa ya da satır silinmişse kod bu varsayılanlarla çalışır.
 *
 * `health_down` ve `engine_stalled` SUNUCU tarafında değerlendirilir (scripts/sunucu/error-watch.sh + alert-send.py):
 * uygulama çökükken kendi kesintisini, motor durmuşken kendi durduğunu bildiremez. Diğer kurallar uygulama içi
 * motorda (`engine.ts`) değerlendirilir.
 */

export const ALERT_RULE_KEYS = [
  "health_down",
  "cron_late",
  "cron_error",
  "error_burst",
  "backup_failed",
  "disk_usage",
  "payment_capture",
  "mrr_drop",
  "kvkk_sla",
  "engine_stalled",
] as const;

export type AlertRuleKey = (typeof ALERT_RULE_KEYS)[number];
export type AlertSeverity = "info" | "warning" | "critical";

export type AlertRuleDef = {
  key: AlertRuleKey;
  label: string;
  description: string;
  severity: AlertSeverity;
  /** Eşik anlamı (yoksa kural eşiksizdir). */
  threshold: { label: string; unit: string; min: number; max: number; default: number } | null;
  defaultRepeatMinutes: number;
  /** Değerlendirmeyi yapan taraf. */
  evaluatedBy: "app" | "host";
};

export const ALERT_RULES: Record<AlertRuleKey, AlertRuleDef> = {
  health_down: {
    key: "health_down",
    label: "Site yanıt vermiyor",
    description: "Sunucu betiği /api/health'i yoklar; eşik süresi boyunca 200 dönmezse uyarı, düzelince 'düzeldi' mesajı gider.",
    severity: "critical",
    threshold: { label: "Kesinti süresi", unit: "dk", min: 1, max: 30, default: 2 },
    defaultRepeatMinutes: 30,
    evaluatedBy: "host",
  },
  cron_late: {
    key: "cron_late",
    label: "Zamanlanmış iş gecikti",
    description: "Bir cron kendi zamanlamasına göre gecikme penceresini aştı (duraklatılan işler hariç).",
    severity: "warning",
    threshold: null,
    defaultRepeatMinutes: 180,
    evaluatedBy: "app",
  },
  cron_error: {
    key: "cron_error",
    label: "Zamanlanmış iş hata verdi",
    description: "Bir cron'un son çalışması 'hata' ile bitti.",
    severity: "warning",
    threshold: null,
    defaultRepeatMinutes: 180,
    evaluatedBy: "app",
  },
  error_burst: {
    key: "error_burst",
    label: "Hata patlaması",
    description: "Son 5 dakikada kaydedilen hata olayı sayısı eşiği aştı (tekrarlar dahil).",
    severity: "critical",
    threshold: { label: "5 dakikada olay", unit: "olay", min: 1, max: 100_000, default: 20 },
    defaultRepeatMinutes: 60,
    evaluatedBy: "app",
  },
  backup_failed: {
    key: "backup_failed",
    label: "Yedek başarısız veya bayat",
    description: "Gece yedeği hata verdi, hiç kaydedilmedi ya da son başarılı yedek eşikten eski.",
    severity: "critical",
    threshold: { label: "En fazla yaş", unit: "saat", min: 1, max: 720, default: 26 },
    defaultRepeatMinutes: 360,
    evaluatedBy: "app",
  },
  disk_usage: {
    key: "disk_usage",
    label: "Disk doluyor",
    description: "Sunucu disk kullanımı eşiği aştı (sunucu ölçümü host-metrics.sh).",
    severity: "critical",
    threshold: { label: "Disk kullanımı", unit: "%", min: 50, max: 99, default: 85 },
    defaultRepeatMinutes: 180,
    evaluatedBy: "app",
  },
  payment_capture: {
    key: "payment_capture",
    label: "Ödeme yakalama hatası",
    description: "Elle inceleme ya da iade bekleyen ödeme yakalama kaydı sayısı eşiğe ulaştı.",
    severity: "critical",
    threshold: { label: "Sorunlu kayıt", unit: "kayıt", min: 1, max: 1000, default: 1 },
    defaultRepeatMinutes: 120,
    evaluatedBy: "app",
  },
  mrr_drop: {
    key: "mrr_drop",
    label: "MRR düşüşü",
    description: "Son günlük MRR anlık görüntüsü 7 gün öncesine göre eşikten fazla düştü.",
    severity: "warning",
    threshold: { label: "7 günde düşüş", unit: "%", min: 1, max: 100, default: 10 },
    defaultRepeatMinutes: 1440,
    evaluatedBy: "app",
  },
  kvkk_sla: {
    key: "kvkk_sla",
    label: "KVKK başvuru süresi",
    description:
      "EmlakSoft'a doğrudan gelen KVKK başvurusunun 30 günlük yasal yanıt süresi geçti ya da eşik kadar gün kaldı (yanıtlanmamış başvurular).",
    severity: "warning",
    threshold: { label: "Kalan gün", unit: "gün", min: 0, max: 20, default: 3 },
    defaultRepeatMinutes: 1440,
    evaluatedBy: "app",
  },
  engine_stalled: {
    key: "engine_stalled",
    label: "Uyarı motoru durdu",
    description:
      "Uygulama içi uyarı motorunun nabzı (uyari-motoru, 5 dakikada bir) eşik süresi boyunca gelmezse sunucu betiği uyarır; nabız dönünce 'düzeldi' mesajı gider. Motor ayardan kapatıldıysa uyarı üretilmez.",
    severity: "critical",
    threshold: { label: "Nabızsız süre", unit: "dk", min: 10, max: 240, default: 20 },
    defaultRepeatMinutes: 60,
    evaluatedBy: "host",
  },
};

export type AlertRuleRow = {
  key: string;
  enabled: boolean | null;
  threshold: number | string | null;
  repeat_minutes: number | null;
  muted_until: string | null;
};

export type AlertRuleConfig = {
  key: AlertRuleKey;
  enabled: boolean;
  threshold: number | null;
  repeatMinutes: number;
  mutedUntil: string | null;
};

export function isAlertRuleKey(v: unknown): v is AlertRuleKey {
  return typeof v === "string" && (ALERT_RULE_KEYS as readonly string[]).includes(v);
}

/** DB satırlarını varsayılanlarla birleştirir; bozuk/aralık dışı eşik = varsayılan. */
export function mergeRuleConfigs(rows: readonly AlertRuleRow[] | null | undefined): Record<AlertRuleKey, AlertRuleConfig> {
  const byKey = new Map((rows ?? []).map((r) => [r.key, r] as const));
  const out = {} as Record<AlertRuleKey, AlertRuleConfig>;
  for (const key of ALERT_RULE_KEYS) {
    const def = ALERT_RULES[key];
    const row = byKey.get(key);
    let threshold: number | null = def.threshold?.default ?? null;
    if (def.threshold && row?.threshold != null) {
      const n = Number(row.threshold);
      if (Number.isFinite(n) && n >= def.threshold.min && n <= def.threshold.max) threshold = n;
    }
    const repeat = Number(row?.repeat_minutes);
    out[key] = {
      key,
      enabled: row?.enabled ?? true,
      threshold,
      repeatMinutes: Number.isInteger(repeat) && repeat >= 5 && repeat <= 10_080 ? repeat : def.defaultRepeatMinutes,
      mutedUntil: row?.muted_until ?? null,
    };
  }
  return out;
}

export function isMuted(cfg: Pick<AlertRuleConfig, "mutedUntil">, nowMs: number): boolean {
  if (!cfg.mutedUntil) return false;
  const t = Date.parse(cfg.mutedUntil);
  return Number.isFinite(t) && t > nowMs;
}

export type NotifyDecision = "notify" | "muted" | "wait";

/**
 * Açık olay için bildirim kararı: sessizdeyse "muted"; hiç bildirilmediyse ya da tekrar aralığı dolduysa "notify";
 * aksi halde "wait".
 */
export function notifyDecision(
  ev: { last_notified_at: string | null },
  cfg: Pick<AlertRuleConfig, "mutedUntil" | "repeatMinutes">,
  nowMs: number,
): NotifyDecision {
  if (isMuted(cfg, nowMs)) return "muted";
  if (!ev.last_notified_at) return "notify";
  const last = Date.parse(ev.last_notified_at);
  if (!Number.isFinite(last)) return "notify";
  return nowMs - last >= cfg.repeatMinutes * 60_000 ? "notify" : "wait";
}

/** Motor nabzı durumu: "ok" (nabız taze), "stalled" (eşik aşıldı), "off" (motor ayardan kapalı), "unknown" (hiç nabız yok). */
export type EnginePulseState = "ok" | "stalled" | "off" | "unknown";

/**
 * Uyarı motoru nabız kararı (SAF; Uyarılar sekmesindeki "motor durdu" rozeti). Sunucu betiğindeki karar
 * (alert-send.py `engine_pulse_state`) ile AYNI kural: nabız yaşı eşik dakikasını AŞARSA durdu; motor kapalıysa ya da
 * kural kapalıysa değerlendirme yok ("off"); hiç nabız yazılmadıysa "unknown" (kurulum/ilk tur; uyarı üretmez).
 */
export function enginePulseState(
  lastRunIso: string | null | undefined,
  nowMs: number,
  thresholdMinutes: number | null,
  opts: { engineEnabled: boolean; ruleEnabled: boolean },
): { state: EnginePulseState; ageMinutes: number | null } {
  if (!opts.engineEnabled || !opts.ruleEnabled) return { state: "off", ageMinutes: null };
  const t = lastRunIso ? Date.parse(lastRunIso) : NaN;
  if (!Number.isFinite(t)) return { state: "unknown", ageMinutes: null };
  const ageMinutes = Math.max(0, Math.floor((nowMs - t) / 60_000));
  const limit = thresholdMinutes ?? ALERT_RULES.engine_stalled.threshold!.default;
  return { state: nowMs - t > limit * 60_000 ? "stalled" : "ok", ageMinutes };
}
