import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { includeSample } from "@/lib/sample-scope";
import { cronDeadline, fetchAllPaged, isPastDeadline } from "@/lib/cron-run";
import { computePriority, explainPriority } from "@/lib/insights/priority";
import { dedupeDrafts, suppressionKey } from "@/lib/insights/dedupe";
import { InsightFactsUnavailable } from "@/lib/insights/facts";
import { qualitySuppressedRules } from "@/lib/insights/quality";
import { isRuleMuted, loadInsightSettings } from "@/lib/insights/settings";
import {
  InsightsTableMissing,
  insertInsights,
  loadActiveRecipients,
  loadNotifiedToday,
  loadOpenKeys,
  loadRuleQuality,
  loadSuppressions,
  markNotified,
  runHousekeeping,
  toInsightRow,
  type InsightRow,
  type Recipient,
} from "@/lib/insights/store";
import { INSIGHT_RULES, buildDigestDraft, DIGEST_RULE_ID, type InsightRule } from "@/lib/insights/rules";
import { INSIGHT_MANAGEMENT_ROLES, ruleBase, type InsightDraft } from "@/lib/insights/types";

/**
 * Insight Engine — tenant tarama döngüsü.
 *
 * - Tenant tarama BÜTÇESİ: çalıştırma başına `maxTenants` ofis + `timeBudgetMs` zaman bütçesi; dolunca kalan iş
 *   sayısı raporlanır ve İMLEÇ (son işlenen ofis id'si) saklanır; sonraki tur kaldığı yerden devam eder.
 *   İmleç `platform_settings` anahtarında durur (ayrı tablo yok).
 * - ÖRNEK VERİ ofiste içgörü ÜRETMEZ: gerçek (is_sample=false) müşteri VE portföy sayısı eşiğin altındaysa ofis atlanır;
 *   ayrıca olgu RPC'lerinin hepsi is_sample=false süzer.
 * - KURAL KALİTE BASTIRMASI: yanlış alarm oranı yüksek kural ofiste sessize alınır; ofis ayarıyla kapatılan kural koşmaz.
 * - HİÇBİR ŞEYİ DEĞİŞTİRMEZ: yalnız `insights` satırı yazar (+ yüksek şiddette zil bildirimi).
 * - `admin` (service_role) çağıran tarafından, kapalı iş seçiciyle verilir; bu dosya istemci oluşturmaz.
 */

export const CURSOR_SETTING_KEY = "insight_engine_cursor";
export const DEFAULT_MAX_TENANTS = 60;
export const DEFAULT_TIME_BUDGET_MS = 240_000;
/** Kullanıcı başına açık içgörü üst sınırı (liste büyürse okunmaz). */
export const MAX_OPEN_PER_USER = 15;
/** Kullanıcı başına günlük zil bildirimi üst sınırı. */
export const MAX_NOTIFY_PER_USER_PER_DAY = 3;
/** Yönetim içgörülerinin fan-out sınırı. */
export const MAX_MANAGEMENT_RECIPIENTS = 10;

export type EngineDeps = {
  /** Yüksek şiddetli içgörüyü zile düşürür (notifyTenant sarmalayıcısı). Fırlatırsa sayılır, engine devam eder. */
  notify?: (n: { tenantId: string; userId: string; title: string; body: string; href: string; dedupeKey: string }) => Promise<void>;
  /** Opsiyonel LLM anlatımı (yalnız ofis ayarı açıksa çağrılır). Null = kural metni kalır. */
  narrate?: (a: { tenantId: string; userId: string; draft: InsightDraft }) => Promise<string | null>;
  /** Test için kural listesi enjeksiyonu. */
  rules?: readonly InsightRule[];
};

export type EngineOptions = {
  nowMs: number;
  maxTenants?: number;
  timeBudgetMs?: number;
  /** Verilirse imleç okunmaz/yazılmaz (ör. tek ofis çalıştırma testi). */
  tenantIds?: readonly string[];
};

export type EngineSummary = {
  tenantsTotal: number;
  tenantsProcessed: number;
  tenantsSkippedSample: number;
  tenantsFailed: number;
  inserted: number;
  notified: number;
  notifyFailed: number;
  rulesUnavailable: string[];
  rulesMuted: number;
  housekeepingDeleted: number | null;
  remaining: number;
  timedOut: boolean;
  tableMissing: boolean;
  wrapped: boolean;
  listError: string | null;
};

export type TenantResult = {
  skipped: "sample" | null;
  inserted: number;
  notified: number;
  notifyFailed: number;
  rulesUnavailable: string[];
  rulesMuted: number;
};

/** Saf: ofiste içgörü üretilsin mi? Gerçek veri eşiğin altındaysa (hâlâ demo ofis) üretilmez. */
export function shouldGenerateForTenant(counts: { realCustomers: number; realProperties: number }): boolean {
  return !includeSample(counts);
}

/** Saf: taslağın alıcılarını çözer (yönetim → yönetim rolündeki aktif kullanıcılar; kullanıcı → aktif ve içgörü alabilen). */
export function resolveRecipients(draft: InsightDraft, recipients: readonly Recipient[]): string[] {
  if (draft.audience.type === "user") {
    const id = draft.audience.userId;
    return recipients.some((r) => r.id === id) ? [id] : [];
  }
  const mgmt = new Set<string>(INSIGHT_MANAGEMENT_ROLES);
  return recipients
    .filter((r) => mgmt.has(r.role))
    .map((r) => r.id)
    .sort()
    .slice(0, MAX_MANAGEMENT_RECIPIENTS);
}

type Resolved = { recipientUserId: string; draft: InsightDraft };

/**
 * Saf çekirdek: taslaklar → (bastırma + dedupe + öncelik + kullanıcı başına üst sınır) → satırlar.
 * `existingOpenKeys`: kullanıcının zaten AÇIK içgörülerinin dedupe anahtarları (tekrar elenir, üst sınıra dahil sayılır).
 */
export function planInsightRows(args: {
  tenantId: string;
  drafts: readonly InsightDraft[];
  recipients: readonly Recipient[];
  suppressed: ReadonlySet<string>;
  dismissalsByRule: ReadonlyMap<string, number>;
  existingOpenKeys: ReadonlyMap<string, ReadonlySet<string>>;
}): { rows: InsightRow[]; resolved: Resolved[] } {
  const fanned: Resolved[] = [];
  for (const draft of args.drafts) {
    for (const uid of resolveRecipients(draft, args.recipients)) {
      if (args.suppressed.has(suppressionKey(uid, ruleBase(draft.ruleId), draft.entityId))) continue;
      // Zaten açık olan içgörü yeniden planlanmaz (kapasiteyi boşuna doldurmasın).
      if (args.existingOpenKeys.get(uid)?.has(draft.dedupeKey)) continue;
      fanned.push({ recipientUserId: uid, draft });
    }
  }
  const unique = dedupeDrafts(fanned);

  const scored = unique.map((it) => {
    const pr = computePriority({
      severity: it.draft.severity,
      urgencyDays: it.draft.urgencyDays,
      impact: it.draft.impact,
      recentDismissals: args.dismissalsByRule.get(ruleBase(it.draft.ruleId)) ?? 0,
    });
    return { ...it, priority: pr.priority, note: explainPriority(pr) };
  });

  // Kullanıcı başına: öncelik azalan, kalan kapasiteye kadar.
  const byUser = new Map<string, typeof scored>();
  for (const s of scored) {
    const list = byUser.get(s.recipientUserId) ?? [];
    list.push(s);
    byUser.set(s.recipientUserId, list);
  }
  const rows: InsightRow[] = [];
  const resolved: Resolved[] = [];
  for (const [uid, list] of byUser) {
    const room = Math.max(0, MAX_OPEN_PER_USER - (args.existingOpenKeys.get(uid)?.size ?? 0));
    list.sort((a, b) => b.priority - a.priority || a.draft.dedupeKey.localeCompare(b.draft.dedupeKey));
    for (const s of list.slice(0, room)) {
      rows.push(toInsightRow({ tenantId: args.tenantId, userId: uid, draft: s.draft, priority: s.priority, priorityNote: s.note }));
      resolved.push({ recipientUserId: uid, draft: s.draft });
    }
  }
  return { rows, resolved };
}

async function countReal(admin: SupabaseClient, tenantId: string, table: "customers" | "properties"): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_sample", false)
    .is("deleted_at", null);
  if (error) throw new Error(`${table}(count): ${error.code ?? "hata"}`);
  return count ?? 0;
}

/** Tek ofis için tam tur. İstisna fırlatabilir (çağıran sayar ve devam eder). */
export async function processTenant(
  admin: SupabaseClient,
  tenantId: string,
  nowMs: number,
  deps: EngineDeps = {},
  deadlineMs: number = Number.POSITIVE_INFINITY,
): Promise<TenantResult> {
  const result: TenantResult = { skipped: null, inserted: 0, notified: 0, notifyFailed: 0, rulesUnavailable: [], rulesMuted: 0 };

  // Örnek veri ofiste içgörü üretmez.
  const [realCustomers, realProperties] = await Promise.all([countReal(admin, tenantId, "customers"), countReal(admin, tenantId, "properties")]);
  if (!shouldGenerateForTenant({ realCustomers, realProperties })) {
    result.skipped = "sample";
    return result;
  }

  const [settings, recipients, quality, suppressions, existingOpenKeys, notifiedToday] = await Promise.all([
    loadInsightSettings(admin, tenantId),
    loadActiveRecipients(admin, tenantId),
    loadRuleQuality(admin, tenantId),
    loadSuppressions(admin, tenantId, nowMs),
    loadOpenKeys(admin, tenantId, nowMs),
    loadNotifiedToday(admin, tenantId, nowMs),
  ]);
  if (recipients.length === 0) return result;

  const qualityMuted = qualitySuppressedRules(quality);
  const isMuted = (ruleId: string) => isRuleMuted(settings, ruleId) || qualityMuted.has(ruleBase(ruleId));

  const drafts: InsightDraft[] = [];
  for (const rule of deps.rules ?? INSIGHT_RULES) {
    if (now() >= deadlineMs) break;
    if (isMuted(rule.id)) {
      result.rulesMuted += 1;
      continue;
    }
    try {
      drafts.push(...(await rule.run(admin, tenantId, nowMs)));
    } catch (e) {
      if (e instanceof InsightFactsUnavailable) {
        if (!result.rulesUnavailable.includes(rule.id)) result.rulesUnavailable.push(rule.id);
        continue;
      }
      // Bir kuralın hatası diğerlerini durdurmaz.
      console.error("insight-engine rule", rule.id, e instanceof Error ? e.message : "hata");
    }
  }

  const plan = planInsightRows({
    tenantId,
    drafts,
    recipients,
    suppressed: suppressions.suppressed,
    dismissalsByRule: suppressions.dismissalsByRule,
    existingOpenKeys,
  });

  // Digest (post kural): kullanıcı başına, yalnız bu turda planlanan + zaten açık olanlarla değil, planlananlarla.
  const rows = [...plan.rows];
  if (!isMuted(DIGEST_RULE_ID)) {
    const perUser = new Map<string, { kind: InsightDraft["kind"]; severity: InsightDraft["severity"] }[]>();
    for (const r of plan.resolved) {
      const list = perUser.get(r.recipientUserId) ?? [];
      list.push({ kind: r.draft.kind, severity: r.draft.severity });
      perUser.set(r.recipientUserId, list);
    }
    for (const [uid, items] of perUser) {
      const digest = buildDigestDraft({ userId: uid, items, nowMs });
      if (!digest) continue;
      // Bugunun ozeti zaten varsa yeniden uretme (LLM anlatimi tur basina tekrar harcanmasin).
      if (existingOpenKeys.get(uid)?.has(digest.dedupeKey)) continue;
      let narrative: string | null = null;
      if (settings.narrativeEnabled && deps.narrate && now() < deadlineMs) {
        try {
          narrative = await deps.narrate({ tenantId, userId: uid, draft: digest });
        } catch {
          narrative = null;
        }
      }
      const pr = computePriority({ severity: digest.severity });
      rows.push(toInsightRow({ tenantId, userId: uid, draft: digest, priority: pr.priority, priorityNote: explainPriority(pr), narrative }));
    }
  }

  const inserted = await insertInsights(admin, rows);
  result.inserted = inserted.length;

  // Yüksek şiddet: zile TEK KEZ (yalnız bu çağrıda gerçekten eklenen satırlar; dedupe_key bildirimde de taşınır).
  if (deps.notify) {
    const sentToday = new Map(notifiedToday);
    const notifiedIds: string[] = [];
    for (const row of inserted) {
      if (row.severity !== "yuksek" || row.kind === "digest") continue;
      if ((sentToday.get(row.recipient_user_id) ?? 0) >= MAX_NOTIFY_PER_USER_PER_DAY) continue;
      try {
        await deps.notify({
          tenantId,
          userId: row.recipient_user_id,
          title: row.title,
          body: row.why,
          href: row.href,
          dedupeKey: `insight:${row.dedupe_key}`.slice(0, 200),
        });
        sentToday.set(row.recipient_user_id, (sentToday.get(row.recipient_user_id) ?? 0) + 1);
        notifiedIds.push(row.id);
        result.notified += 1;
      } catch {
        result.notifyFailed += 1;
      }
    }
    try {
      await markNotified(admin, tenantId, notifiedIds, nowMs);
    } catch {
      // notified_at yazılamadıysa zil bildirimi yine de gönderildi; bir sonraki turda dedupe_key tekrarı engeller.
    }
  }
  return result;
}

/** Saf: imleçten sonraki ofis kimlikleri (sıralı) ve kalan sayısı. */
export function selectTenantBatch(sortedIds: readonly string[], cursor: string | null, maxTenants: number): { batch: string[]; remainingAfter: number; wrapsAround: boolean } {
  const after = cursor ? sortedIds.filter((id) => id > cursor) : [...sortedIds];
  const batch = after.slice(0, Math.max(1, maxTenants));
  const remainingAfter = Math.max(0, after.length - batch.length);
  return { batch, remainingAfter, wrapsAround: remainingAfter === 0 };
}

async function readCursor(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin.from("platform_settings").select("value").eq("key", CURSOR_SETTING_KEY).maybeSingle();
  const v = (data as { value?: string | null } | null)?.value;
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

async function writeCursor(admin: SupabaseClient, value: string): Promise<void> {
  await admin.from("platform_settings").upsert({ key: CURSOR_SETTING_KEY, value, updated_at: new Date(now()).toISOString() }, { onConflict: "key" });
}

export async function runInsightEngine(admin: SupabaseClient, opts: EngineOptions, deps: EngineDeps = {}): Promise<EngineSummary> {
  const summary: EngineSummary = {
    tenantsTotal: 0,
    tenantsProcessed: 0,
    tenantsSkippedSample: 0,
    tenantsFailed: 0,
    inserted: 0,
    notified: 0,
    notifyFailed: 0,
    rulesUnavailable: [],
    rulesMuted: 0,
    housekeepingDeleted: null,
    remaining: 0,
    timedOut: false,
    tableMissing: false,
    wrapped: false,
    listError: null,
  };
  const startedAt = now();
  const deadline = cronDeadline(startedAt, opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);

  let ids: string[];
  if (opts.tenantIds) {
    ids = [...opts.tenantIds].sort();
  } else {
    const { rows, error } = await fetchAllPaged<{ id: string }>((from, to) =>
      admin
        .from("tenants")
        .select("id")
        .in("status", ["active", "trial", "past_due"])
        .order("id", { ascending: true })
        .range(from, to),
    );
    summary.listError = error;
    ids = rows.map((r) => r.id);
  }
  summary.tenantsTotal = ids.length;

  const cursor = opts.tenantIds ? null : await readCursor(admin).catch(() => null);
  const { batch, remainingAfter, wrapsAround } = selectTenantBatch(ids, cursor, opts.maxTenants ?? DEFAULT_MAX_TENANTS);

  let lastProcessed: string | null = null;
  for (const [i, tenantId] of batch.entries()) {
    if (isPastDeadline(now(), deadline)) {
      summary.timedOut = true;
      summary.remaining = remainingAfter + (batch.length - i);
      break;
    }
    try {
      const r = await processTenant(admin, tenantId, opts.nowMs, deps, deadline);
      summary.tenantsProcessed += 1;
      summary.inserted += r.inserted;
      summary.notified += r.notified;
      summary.notifyFailed += r.notifyFailed;
      summary.rulesMuted += r.rulesMuted;
      if (r.skipped === "sample") summary.tenantsSkippedSample += 1;
      for (const u of r.rulesUnavailable) if (!summary.rulesUnavailable.includes(u)) summary.rulesUnavailable.push(u);
    } catch (e) {
      if (e instanceof InsightsTableMissing) {
        summary.tableMissing = true;
        break;
      }
      summary.tenantsFailed += 1;
      console.error("insight-engine tenant", tenantId, e instanceof Error ? e.message : "hata");
    }
    lastProcessed = tenantId;
  }
  if (!summary.timedOut && !summary.tableMissing) summary.remaining = remainingAfter;

  if (!opts.tenantIds && !summary.tableMissing) {
    const finished = !summary.timedOut && wrapsAround;
    summary.wrapped = finished;
    try {
      if (finished) {
        await writeCursor(admin, "");
        summary.housekeepingDeleted = await runHousekeeping(admin).catch(() => null);
      } else if (lastProcessed) {
        await writeCursor(admin, lastProcessed);
      }
    } catch {
      // İmleç yazılamazsa sonraki tur aynı ofislerden başlar (içgörüler dedupe ile korunur).
    }
  }
  return summary;
}

