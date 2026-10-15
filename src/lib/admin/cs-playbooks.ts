import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, trDayKey, trParts } from "@/lib/clock";
import { weekPeriod } from "@/lib/insights/dedupe";
import { getSettings } from "@/lib/settings/read";
import { CRM_SETTING_KEYS } from "@/lib/settings/registry/crm";
import { loadDemoTenantIds } from "@/lib/demo-sandbox";
import { fetchAllPaged } from "@/lib/cron-run";
import { HEALTH_DEFAULT_RISK_THRESHOLD } from "./health-score";
import { isCrmMissing } from "./platform-crm";
import { PLAYBOOK_RULES, PLAYBOOK_RULE_LABELS, isPlaybookRule, type PlaybookRule, type TaskPriority } from "./cs-playbook-labels";

/**
 * MÜŞTERİ BAŞARISI OYUN KİTAPLARI (PA-1) — `gorev-hatirlat` cron'unun ayrık adımı (yeni cron yok).
 * Tetikleyici → `platform_tasks` satırı (sorumlu = ofisin sorumlu personeli; yoksa "Atanmamış" kuyruğu) + zil bildirimi.
 *
 *  - health_threshold : sağlık skoru riskli eşiğin ALTINA ilk kez indi (dün ≥ eşik, bugün < eşik).
 *  - health_drop      : skor son 7 günün en yükseğinden en az N puan düştü (ayar `crm.playbook_drop_points`).
 *  - nps_detractor    : son 3 günde 0-6 NPS yanıtı.
 *  - low_csat         : son 3 günde destek talebine 1-2 memnuniyet puanı.
 *  - cancel_request   : son 7 günde dönem sonunda iptal talebi.
 *  - trial_inactive   : kaydının 3-7. gününde hiç portföyü olmayan deneme ofisi.
 *
 * Tekrar yok: her taslağın `dedupe_key`'i UNIQUE (aynı tetik ikinci kez görev açmaz); sağlık kuralları haftalık anahtarla
 * (skor sınırda gidip gelince her gün görev açılmaz). Kural başına tur sınırı `PLAYBOOK_RULE_CAP`. Demo ofis hariç.
 * Değerlendirme SAF (`evaluate*`); okuma/yazma `runCsPlaybooks`. Sütunlar yoksa (migration bekliyor) adım `skipped`.
 */

export { PLAYBOOK_RULES, PLAYBOOK_RULE_LABELS, isPlaybookRule, type PlaybookRule, type TaskPriority } from "./cs-playbook-labels";

export type PlaybookDraft = {
  rule: PlaybookRule;
  tenantId: string;
  title: string;
  body: string;
  dueInDays: number;
  priority: TaskPriority;
  dedupeKey: string;
};

/** Kural başına tek turda en çok görev (görev seli freni; kalanı sonraki turda, anahtar aynı kalır). */
export const PLAYBOOK_RULE_CAP = 25;
export const PLAYBOOK_DEFAULT_DROP = 15;
export const NPS_DETRACTOR_MAX = 6;
export const CSAT_LOW_MAX = 2;
export const TRIAL_INACTIVE_FROM_DAYS = 3;
export const TRIAL_INACTIVE_TO_DAYS = 7;

const title = (name: string, text: string) => `${name}: ${text}`.slice(0, 160);
const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ---- Sağlık --------------------------------------------------------------------------------------------------------

export type HealthPointFact = { tenantId: string; day: string; score: number };

/**
 * Ofis başına günlük skorlar → eşik altına iniş / 7 günde düşüş. `todayKey` (TR günü) için skor yoksa ofis atlanır
 * (bugünkü hesap henüz yazılmadı). Eşik altına iniş görevi açılan ofiste ayrıca düşüş görevi açılmaz (tek görev).
 */
export function evaluateHealth(
  points: readonly HealthPointFact[],
  names: ReadonlyMap<string, string>,
  opts: { todayKey: string; threshold: number; dropPoints: number; nowMs: number },
): PlaybookDraft[] {
  const byTenant = new Map<string, HealthPointFact[]>();
  for (const p of points) {
    const list = byTenant.get(p.tenantId) ?? [];
    list.push(p);
    byTenant.set(p.tenantId, list);
  }
  const week = weekPeriod(opts.nowMs);
  const out: PlaybookDraft[] = [];
  for (const [tenantId, list] of byTenant) {
    const sorted = [...list].sort((a, b) => a.day.localeCompare(b.day));
    const today = sorted.find((p) => p.day === opts.todayKey);
    if (!today) continue;
    const prior = sorted.filter((p) => p.day < opts.todayKey);
    const name = names.get(tenantId) ?? "Ofis";
    const yesterday = prior[prior.length - 1];
    if (today.score < opts.threshold && yesterday && yesterday.score >= opts.threshold) {
      out.push({
        rule: "health_threshold",
        tenantId,
        title: title(name, `sağlık skoru riskli eşiğin altına indi (${today.score})`),
        body: `Skor ${yesterday.score} → ${today.score} (eşik ${opts.threshold}). Ofis 360 > Sağlık sekmesinde düşüş nedenlerini inceleyin ve ofis sahibiyle görüşün.`,
        dueInDays: 1,
        priority: "yuksek",
        dedupeKey: `health_threshold:${tenantId}:${week}`,
      });
      continue;
    }
    const peak = prior.reduce<HealthPointFact | null>((m, p) => (!m || p.score > m.score ? p : m), null);
    if (peak && peak.score - today.score >= opts.dropPoints) {
      out.push({
        rule: "health_drop",
        tenantId,
        title: title(name, `sağlık skoru ${peak.score - today.score} puan düştü`),
        body: `Son 7 günün en yükseği ${peak.score} (${peak.day}), bugün ${today.score}. Kullanım, ödeme ve destek bileşenlerini kontrol edin.`,
        dueInDays: 2,
        priority: today.score < opts.threshold ? "yuksek" : "normal",
        dedupeKey: `health_drop:${tenantId}:${week}`,
      });
    }
  }
  return out;
}

// ---- NPS / CSAT ----------------------------------------------------------------------------------------------------

export type NpsFact = { id: string; tenantId: string; name: string; score: number; comment: string | null };

export function evaluateNps(rows: readonly NpsFact[]): PlaybookDraft[] {
  return rows
    .filter((r) => Number.isInteger(r.score) && r.score >= 0 && r.score <= NPS_DETRACTOR_MAX)
    .map((r) => ({
      rule: "nps_detractor" as const,
      tenantId: r.tenantId,
      title: title(r.name, `NPS yanıtı ${r.score}/10 (kötüleyen)`),
      body: r.comment ? `Yorum: "${clip(r.comment, 600)}". Kullanıcıyla 2 gün içinde görüşüp sorunu kapatın.` : "Yorum bırakılmadı. Kullanıcıyla 2 gün içinde görüşüp memnuniyetsizliğin nedenini öğrenin.",
      dueInDays: 2,
      priority: r.score <= 3 ? ("yuksek" as const) : ("normal" as const),
      dedupeKey: `nps:${r.id}`,
    }));
}

export type CsatFact = { ticketId: string; tenantId: string; name: string; score: number; comment: string | null };

export function evaluateCsat(rows: readonly CsatFact[]): PlaybookDraft[] {
  return rows
    .filter((r) => r.score >= 1 && r.score <= CSAT_LOW_MAX)
    .map((r) => ({
      rule: "low_csat" as const,
      tenantId: r.tenantId,
      title: title(r.name, `destek memnuniyeti ${r.score}/5`),
      body: `${r.comment ? `Yorum: "${clip(r.comment, 600)}". ` : ""}Talebi yeniden inceleyin, ofisle iletişime geçip çözümü teyit edin.`,
      dueInDays: 1,
      priority: "yuksek" as const,
      dedupeKey: `csat:${r.ticketId}`,
    }));
}

// ---- İptal talebi --------------------------------------------------------------------------------------------------

export type CancelFact = { subscriptionId: string; tenantId: string; name: string; requestedAt: string | null; periodEnd: string | null; reason: string | null };

export function evaluateCancel(rows: readonly CancelFact[]): PlaybookDraft[] {
  return rows.map((r) => ({
    rule: "cancel_request" as const,
    tenantId: r.tenantId,
    title: title(r.name, "dönem sonunda iptal talep etti"),
    body: `${r.periodEnd ? `Abonelik ${r.periodEnd.slice(0, 10)} tarihinde kapanacak. ` : ""}${r.reason ? `Neden: "${clip(r.reason, 400)}". ` : ""}Dönem bitmeden ofisle görüşün; paket düşürme ya da duraklatma seçeneklerini sunun.`,
    dueInDays: 1,
    priority: "yuksek" as const,
    dedupeKey: `cancel:${r.subscriptionId}:${(r.requestedAt ?? "").slice(0, 10) || "talep"}`,
  }));
}

// ---- Erken deneme hareketsizliği ----------------------------------------------------------------------------------

export type TrialFact = { tenantId: string; name: string; createdAt: string; properties: number };

export function evaluateTrialInactive(rows: readonly TrialFact[], nowMs: number): PlaybookDraft[] {
  const out: PlaybookDraft[] = [];
  for (const r of rows) {
    const created = Date.parse(r.createdAt);
    if (!Number.isFinite(created)) continue;
    const age = (nowMs - created) / DAY_MS;
    if (age < TRIAL_INACTIVE_FROM_DAYS || age >= TRIAL_INACTIVE_TO_DAYS || r.properties > 0) continue;
    out.push({
      rule: "trial_inactive",
      tenantId: r.tenantId,
      title: title(r.name, `deneme ${Math.floor(age)}. gün, henüz portföy yok`),
      body: "Ofis kayıttan bu yana ilk portföyünü eklemedi. Kısa bir kurulum görüşmesi önerin; içe aktarma ya da örnek veriyle başlamasına yardım edin.",
      dueInDays: 1,
      priority: "normal",
      dedupeKey: `trial_inactive:${r.tenantId}`,
    });
  }
  return out;
}

/** Kural başına üst sınır (sıra korunur). */
export function capPerRule(drafts: readonly PlaybookDraft[], cap = PLAYBOOK_RULE_CAP): PlaybookDraft[] {
  const seen = new Map<PlaybookRule, number>();
  const keys = new Set<string>();
  const out: PlaybookDraft[] = [];
  for (const d of drafts) {
    if (keys.has(d.dedupeKey)) continue;
    const n = seen.get(d.rule) ?? 0;
    if (n >= cap) continue;
    seen.set(d.rule, n + 1);
    keys.add(d.dedupeKey);
    out.push(d);
  }
  return out;
}

// ---- Çalıştırıcı ---------------------------------------------------------------------------------------------------

export type PlaybookSummary = {
  skipped: boolean;
  /** Kural başına açılan görev. */
  created: Partial<Record<PlaybookRule, number>>;
  unassigned: number;
  error: string | null;
};

const MISSING_COLUMN = /42703|PGRST204|source_rule|dedupe_key/i;

/** Sağlık kuralları yalnız sabah turlarında (günlük skor gece hesaplanır; gün içi turlar tekrar okumaz). */
export const HEALTH_RULE_LAST_TR_HOUR = 10;

async function readOpts(): Promise<{ enabled: boolean; threshold: number; drop: number }> {
  try {
    const s = await getSettings([CRM_SETTING_KEYS.playbooksEnabled, CRM_SETTING_KEYS.riskThreshold, CRM_SETTING_KEYS.playbookDropPoints]);
    return {
      enabled: s[CRM_SETTING_KEYS.playbooksEnabled] !== false,
      threshold: Number(s[CRM_SETTING_KEYS.riskThreshold]) || HEALTH_DEFAULT_RISK_THRESHOLD,
      drop: Number(s[CRM_SETTING_KEYS.playbookDropPoints]) || PLAYBOOK_DEFAULT_DROP,
    };
  } catch {
    return { enabled: true, threshold: HEALTH_DEFAULT_RISK_THRESHOLD, drop: PLAYBOOK_DEFAULT_DROP };
  }
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function runCsPlaybooks(admin: SupabaseClient, nowMs: number): Promise<PlaybookSummary> {
  const summary: PlaybookSummary = { skipped: false, created: {}, unassigned: 0, error: null };
  const opts = await readOpts();
  if (!opts.enabled) return { ...summary, skipped: true };

  // Şema kapısı: sütunlar yoksa hiçbir şey okunmaz/yazılmaz.
  const probe = await admin.from("platform_tasks").select("id, source_rule, dedupe_key").limit(1);
  if (probe.error) {
    if (isCrmMissing(probe.error) || MISSING_COLUMN.test(`${probe.error.code ?? ""} ${probe.error.message ?? ""}`)) return { ...summary, skipped: true };
    return { ...summary, error: probe.error.message };
  }

  const todayKey = trDayKey(nowMs);
  const since3 = new Date(nowMs - 3 * DAY_MS).toISOString();
  const since7 = new Date(nowMs - 7 * DAY_MS).toISOString();
  const runHealth = trParts(nowMs).hour < HEALTH_RULE_LAST_TR_HOUR;

  const [health, nps, csat, cancels, trials, demo] = await Promise.all([
    runHealth
      ? fetchAllPaged<{ tenant_id: string; day: string; score: number }>(
          (from, to) => admin.from("tenant_health_daily").select("tenant_id, day, score").gte("day", trDayKey(nowMs - 7 * DAY_MS)).order("tenant_id").order("day").range(from, to),
          1000,
          30,
        )
      : Promise.resolve({ rows: [] as { tenant_id: string; day: string; score: number }[], error: null }),
    admin
      .from("platform_nps_responses")
      .select("id, tenant_id, score, comment, tenant:tenants!platform_nps_responses_tenant_id_fkey(name)")
      .gte("responded_at", since3)
      .lte("score", NPS_DETRACTOR_MAX)
      .order("responded_at", { ascending: true })
      .limit(200),
    admin
      .from("support_ticket_csat")
      .select("ticket_id, tenant_id, score, comment, tenant:tenants!support_ticket_csat_tenant_id_fkey(name)")
      .gte("created_at", since3)
      .lte("score", CSAT_LOW_MAX)
      .order("created_at", { ascending: true })
      .limit(200),
    admin
      .from("subscriptions")
      .select("id, tenant_id, cancel_requested_at, current_period_end, cancel_reason, tenant:tenants!subscriptions_tenant_id_fkey(name, status)")
      .eq("cancel_at_period_end", true)
      .neq("status", "cancelled")
      .gte("cancel_requested_at", since7)
      .limit(200),
    admin
      .from("tenants")
      .select("id, name, created_at")
      .eq("status", "trial")
      .gte("created_at", new Date(nowMs - TRIAL_INACTIVE_TO_DAYS * DAY_MS).toISOString())
      .lte("created_at", new Date(nowMs - TRIAL_INACTIVE_FROM_DAYS * DAY_MS).toISOString())
      .limit(200),
    loadDemoTenantIds(admin).catch(() => new Set<string>()),
  ]);

  const drafts: PlaybookDraft[] = [];
  const names = new Map<string, string>();

  if (health.rows.length > 0) {
    const ids = [...new Set(health.rows.map((r) => r.tenant_id))];
    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await admin.from("tenants").select("id, name").in("id", ids.slice(i, i + 500)).neq("status", "cancelled");
      for (const t of (data ?? []) as { id: string; name: string }[]) names.set(t.id, t.name);
    }
    const live = health.rows.filter((r) => names.has(r.tenant_id));
    drafts.push(...evaluateHealth(live.map((r) => ({ tenantId: r.tenant_id, day: r.day, score: Number(r.score) })), names, { todayKey, threshold: opts.threshold, dropPoints: opts.drop, nowMs }));
  }
  if (!nps.error) {
    drafts.push(
      ...evaluateNps(
        ((nps.data ?? []) as unknown as { id: string; tenant_id: string; score: number; comment: string | null; tenant: { name: string } | { name: string }[] | null }[]).map((r) => ({
          id: r.id,
          tenantId: r.tenant_id,
          name: one(r.tenant)?.name ?? "Ofis",
          score: Number(r.score),
          comment: r.comment,
        })),
      ),
    );
  }
  if (!csat.error) {
    drafts.push(
      ...evaluateCsat(
        ((csat.data ?? []) as unknown as { ticket_id: string; tenant_id: string; score: number; comment: string | null; tenant: { name: string } | { name: string }[] | null }[]).map((r) => ({
          ticketId: r.ticket_id,
          tenantId: r.tenant_id,
          name: one(r.tenant)?.name ?? "Ofis",
          score: Number(r.score),
          comment: r.comment,
        })),
      ),
    );
  }
  if (!cancels.error) {
    drafts.push(
      ...evaluateCancel(
        ((cancels.data ?? []) as unknown as { id: string; tenant_id: string; cancel_requested_at: string | null; current_period_end: string | null; cancel_reason: string | null; tenant: { name: string; status: string } | { name: string; status: string }[] | null }[])
          .filter((r) => one(r.tenant)?.status !== "cancelled")
          .map((r) => ({ subscriptionId: r.id, tenantId: r.tenant_id, name: one(r.tenant)?.name ?? "Ofis", requestedAt: r.cancel_requested_at, periodEnd: r.current_period_end, reason: r.cancel_reason })),
      ),
    );
  }
  if (!trials.error && (trials.data ?? []).length > 0) {
    const rows = (trials.data ?? []) as { id: string; name: string; created_at: string }[];
    const counts = await propertyCounts(admin, rows.map((r) => r.id));
    drafts.push(
      ...evaluateTrialInactive(
        rows.filter((r) => counts.has(r.id)).map((r) => ({ tenantId: r.id, name: r.name, createdAt: r.created_at, properties: counts.get(r.id) ?? 0 })),
        nowMs,
      ),
    );
  }

  const todo = capPerRule(drafts.filter((d) => !demo.has(d.tenantId)));
  if (todo.length === 0) return summary;

  const tenantIds = [...new Set(todo.map((d) => d.tenantId))];
  const owners = new Map<string, string>();
  const { data: crm } = await admin.from("platform_tenant_crm").select("tenant_id, account_owner_staff_id").in("tenant_id", tenantIds);
  for (const c of (crm ?? []) as { tenant_id: string; account_owner_staff_id: string | null }[]) if (c.account_owner_staff_id) owners.set(c.tenant_id, c.account_owner_staff_id);

  const rows = todo.map((d) => ({
    tenant_id: d.tenantId,
    title: d.title,
    body: d.body.slice(0, 1000),
    assignee_staff_id: owners.get(d.tenantId) ?? null,
    due_at: new Date(nowMs + d.dueInDays * DAY_MS).toISOString(),
    source_rule: d.rule,
    dedupe_key: d.dedupeKey,
    priority: d.priority,
  }));
  const ins = await admin.from("platform_tasks").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id, tenant_id, title, assignee_staff_id, source_rule");
  if (ins.error) return { ...summary, error: ins.error.message };
  const created = (ins.data ?? []) as { id: string; tenant_id: string; title: string; assignee_staff_id: string | null; source_rule: string }[];
  for (const t of created) if (isPlaybookRule(t.source_rule)) summary.created[t.source_rule] = (summary.created[t.source_rule] ?? 0) + 1;

  // Zil: sorumluya görev başına bir bildirim; sahipsizler için operasyon/süper admine TEK özet.
  const notes: Record<string, unknown>[] = created
    .filter((t) => t.assignee_staff_id)
    .map((t) => ({
      staff_id: t.assignee_staff_id,
      title: "Yeni müşteri başarısı görevi",
      body: t.title,
      href: `/admin/gorevler?gorev=${t.id}`,
      kind: "warning",
      meta: { source: "cs_playbook", task_id: t.id, rule: t.source_rule },
    }));
  summary.unassigned = created.filter((t) => !t.assignee_staff_id).length;
  if (summary.unassigned > 0) {
    const { data: leads } = await admin.from("platform_staff").select("id").eq("is_active", true).in("role", ["super_admin", "ops"]).limit(20);
    for (const s of (leads ?? []) as { id: string }[]) {
      notes.push({
        staff_id: s.id,
        title: `${summary.unassigned} sahipsiz müşteri başarısı görevi`,
        body: "Sorumlu personeli olmayan ofisler için otomatik görev açıldı. Görevleri üstlenin ya da atayın.",
        href: "/admin/gorevler?sekme=atanmamis",
        kind: "info",
        meta: { source: "cs_playbook_unassigned", count: summary.unassigned },
      });
    }
  }
  if (notes.length > 0) {
    const n = await admin.from("platform_notifications").insert(notes);
    if (n.error) summary.error = `bildirim: ${n.error.message}`;
  }
  return summary;
}

/** Ofis başına portföy sayısı: önce değer sayımı RPC'si, yoksa ofis başına sayım (deneme penceresi küçük). */
async function propertyCounts(admin: SupabaseClient, ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const { data, error } = await admin.rpc("platform_tenant_value_counts", { p_tenant_ids: ids.slice(0, 500) });
  if (!error) {
    for (const r of (data ?? []) as { tenant_id: string; properties: number }[]) out.set(r.tenant_id, Number(r.properties) || 0);
    return out;
  }
  for (const id of ids.slice(0, 100)) {
    const { count, error: e } = await admin.from("properties").select("id", { count: "exact", head: true }).eq("tenant_id", id).is("deleted_at", null);
    if (!e) out.set(id, count ?? 0);
  }
  return out;
}

/** Heartbeat özeti: "3 görev (sağlık 1, NPS 2)". */
export function playbookNote(s: PlaybookSummary | undefined): string {
  if (!s) return "hata verdi";
  if (s.skipped) return "atlandı";
  const parts = PLAYBOOK_RULES.filter((r) => (s.created[r] ?? 0) > 0).map((r) => `${PLAYBOOK_RULE_LABELS[r]} ${s.created[r]}`);
  const total = Object.values(s.created).reduce((a, b) => a + (b ?? 0), 0);
  return `${total} görev${parts.length ? ` (${parts.join(", ")})` : ""}${s.unassigned ? `, ${s.unassigned} sahipsiz` : ""}${s.error ? ` (hata: ${s.error.slice(0, 80)})` : ""}`;
}
