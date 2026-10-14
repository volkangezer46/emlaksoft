/**
 * Zamanlanmış rapor TESLİMİ (DG4) — mevcut `gunluk-ozet` cron'unun AYRIK adımı (yeni cron YOK). SUNUCU kodudur.
 *
 * Akış (abonelik başına): zamanı gelmiş (`next_run_at <= şimdi`, aktif) satır → dönem anahtarıyla teslim günlüğüne
 * TEKİL kayıt (aynı dönem ikinci kez gönderilmez) → abonelik sahibi + ofis/personel durumu yeniden doğrulanır → her alıcı
 * için rapor ALICININ KENDİ yetkisi ve veri kapsamıyla üretilir (yetkisi yoksa o alıcı atlanır; başkasının kapsamı sızmaz)
 * → `sendLoggedEmail` (AD7) ile dosya eki gönderilir. E-posta kanalı kapalıysa rapor üretilmez; her alıcı için AD7
 * günlüğüne 'disabled' ("kanal kapalı") düşer ve teslim günlüğü `channel_disabled` olur. Sonra `next_run_at` ilerler.
 *
 * Kiracı raporu oturumsuz çalışır: istemci, çağıran cron'un servis istemcisidir (parametre; bu modül kendisi
 * oluşturmaz). Bu yüzden YALNIZ sorgu kaynaklı raporlar zamanlanır (`isSchedulable`): kiracı sınırı ve aktör kapsamı
 * sorgunun içinde açık süzgeçtir ve `export-data-scope-contract` bunu her rapor için çalıştırarak doğrular. Alıcının
 * izinleri DB'den (rol + ofis + kullanıcı istisnaları) birleştirilir; liste kapsamı zorlaması açık ofiste sahip
 * dışındaki herkes yalnız kendi kayıtlarını alır (fail-closed). Ofis "toplu dışa aktarma onayı" kuralı açıksa onaydan
 * muaf olmayan (owner/gm dışı) alıcıya gönderilmez.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { lockedGate } from "@/lib/billing/page-gates";
import { featureForPermissionModule } from "@/lib/modules/guard";
import type { FeatureKey } from "@/lib/modules/registry";
import { evaluateApprovalRule } from "@/lib/oversight/approval-gate";
import type { ApprovalRules } from "@/lib/oversight/settings";
import { loadApprovalRules } from "@/lib/oversight/store";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { effectiveHasPermission, mergeEffectivePermissions, type EffectivePermissions, type RoleOverrideRow, type UserOverrideRow } from "@/lib/permissions-merge";
import { platformCanAccess, type PlatformRole } from "@/lib/platform-access";
import { loadSampleKpiScope } from "@/lib/sample-scope";
import { SCOPE_ENFORCEMENT_KEY } from "@/lib/settings/registry/tenant";
import { getSettingDef } from "@/lib/settings/registry";
import { coerceInput } from "@/lib/settings/view";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { summarizeFilters } from "./filters";
import { reportCenterHref } from "./links";
import { getReport, platformReportAllowed, tenantReportAllowed } from "./registry";
import { storedViewFilters } from "./saved-views";
import { isSchedulable, nextRunDay, periodRange, runDayStartIso, scheduledFilters, trKeyOf, hasDateRange, type ScheduleSpec, type SubscriptionFrequency } from "./schedule";
import { REPORT_FORMAT_LABELS, type Filters, type ReportContext, type ReportDb, type ReportDef, type ReportFormat } from "./types";
import { formatDateTr } from "./values";
import type { RenderResult } from "./render";

export const SUBSCRIPTION_SEND_ACTION = "report.subscription.sent";
const SOURCE = "report-subscription";
const TEMPLATE = "report_subscription";
/** Bir cron turunda işlenen en çok abonelik (süre bütçesi; kalanlar ertesi tura kalır, `next_run_at` ilerlemez). */
export const DELIVERY_BATCH = 40;
const ACTIVE_TENANT_STATUSES = ["active", "trial", "past_due"];
const MISSING = new Set(["42P01", "PGRST205", "42703"]);

type Db = SupabaseClient;

export type SubscriptionRow = {
  id: string;
  scope: "tenant" | "platform";
  tenant_id: string | null;
  user_id: string | null;
  staff_id: string | null;
  report_id: string;
  name: string;
  filters: unknown;
  relative_range: boolean;
  format: ReportFormat;
  frequency: SubscriptionFrequency;
  weekday: number | null;
  month_day: number | null;
  recipient_ids: string[];
  next_run_at: string;
};

export type RunStatus = "sent" | "partial" | "channel_disabled" | "failed" | "skipped";

export type SendEmailFn = (input: {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Uint8Array }[];
  template: string;
  source: string;
  tenantId?: string | null;
  actorId?: string | null;
}) => Promise<{ ok: true; id: string | null } | { ok: false; code: string; error: string }>;

export type RenderFn = (opts: { format: ReportFormat; def: ReportDef; ctx: ReportContext; filters: Filters; generatedBy?: string }) => Promise<RenderResult>;

export type DeliveryDeps = {
  nowMs: number;
  send: SendEmailFn;
  render: RenderFn;
  channel: () => Promise<{ enabled: boolean; reason: string | null }>;
  /** Ofis kullanıcısının giriş e-postası (auth). */
  userEmail: (userId: string) => Promise<string | null>;
  platformContext: (staff: { id: string; role: string }) => ReportContext;
  audit: (entry: { scope: "tenant" | "platform"; tenantId: string | null; actorId: string; def: ReportDef; subscriptionId: string; value: Record<string, unknown> }) => Promise<void>;
  /** Ek ekin bayt tavanı (aşılırsa ek yerine rapor merkezi bağlantısı). */
  attachmentMaxBytes: number;
  appUrl: string;
  disabledModules?: Map<string, Set<FeatureKey>>;
  /** Süre bütçesi doldu mu (cron son tarihi). */
  shouldStop?: () => boolean;
};

export type DeliverySummary = {
  due: number;
  processed: number;
  sent: number;
  channelDisabled: number;
  failed: number;
  skipped: number;
  schemaMissing: boolean;
};

type Outcome = { status: RunStatus; recipients: number; sent: number; rows: number; error: string | null };

type TenantInfo = {
  ok: boolean;
  reason?: string;
  name: string;
  enforced: boolean;
  sample: ReportContext["sample"] | null;
  rules: ApprovalRules | null;
  rulesError: boolean;
};

const short = (s: string | null | undefined) => (s ? s.slice(0, 300) : null);

function dayTr(key: string): string {
  return formatDateTr(key);
}

/** Alıcının etkin izinleri: varsayılan matris + ofis rol istisnaları + kullanıcı istisnaları (servis istemcisiyle, AÇIK kiracı süzgeci). */
async function loadPerms(db: Db, tenantId: string, userId: string, role: string, nowMs: number): Promise<EffectivePermissions> {
  try {
    const [roleRes, userRes] = await Promise.all([
      db.from("tenant_role_permissions").select("module, action, allowed").eq("tenant_id", tenantId).eq("role", role),
      role === "owner"
        ? Promise.resolve({ data: [] as UserOverrideRow[], error: null })
        : db.from("user_permission_overrides").select("module, actions, expires_at").eq("tenant_id", tenantId).eq("user_id", userId),
    ]);
    if (roleRes.error || userRes.error) return {};
    return mergeEffectivePermissions(role, (roleRes.data ?? []) as RoleOverrideRow[], (userRes.data ?? []) as UserOverrideRow[], nowMs);
  } catch {
    return {};
  }
}

async function loadTenantInfo(db: Db, tenantId: string, def: ReportDef, deps: DeliveryDeps): Promise<TenantInfo> {
  const empty: TenantInfo = { ok: false, name: "Ofis", enforced: true, sample: null, rules: null, rulesError: false };
  const { data: t } = await db.from("tenants").select("id, name, status, plan, created_at").eq("id", tenantId).maybeSingle();
  const tenant = t as { name?: string | null; status?: string | null; plan?: string | null; created_at?: string | null } | null;
  if (!tenant || !ACTIVE_TENANT_STATUSES.includes(String(tenant.status))) return { ...empty, reason: "Ofis aktif değil." };
  if (lockedGate("/app/raporlar", { plan: tenant.plan, trial: tenant.status === "trial", tenantCreatedAt: tenant.created_at })) {
    return { ...empty, reason: "Ofisin paketi raporları kapsamıyor." };
  }
  const feature = def.module ? featureForPermissionModule(def.module) : null;
  if (feature && deps.disabledModules?.get(tenantId)?.has(feature)) return { ...empty, reason: "Raporun modülü ofiste kapalı." };

  const enforcementDef = getSettingDef(SCOPE_ENFORCEMENT_KEY);
  const [setting, sample, rules] = await Promise.all([
    db.from("tenant_settings").select("value").eq("tenant_id", tenantId).eq("key", SCOPE_ENFORCEMENT_KEY).maybeSingle(),
    loadSampleKpiScope(db, tenantId).catch(() => null),
    loadApprovalRules(db, tenantId).then(
      (r) => ({ rules: r, error: false }),
      () => ({ rules: null, error: true }),
    ),
  ]);
  // Ayar okunamazsa kapsam zorlaması AÇIK sayılır (fail-closed: yalnız kendi kayıtları).
  let enforced = true;
  if (!setting.error && enforcementDef) {
    const raw = (setting.data as { value?: unknown } | null)?.value;
    if (raw === undefined || raw === null) enforced = enforcementDef.default === true;
    else {
      const c = coerceInput(enforcementDef, raw);
      enforced = c.ok ? c.value === true : true;
    }
  }
  if (!sample) return { ...empty, reason: "Ofis verisi okunamadı." };
  return { ok: true, name: tenant.name?.trim() || "Ofis", enforced, sample, rules: rules.rules, rulesError: rules.error };
}

/** Alıcının kendi rapor bağlamı (oturumsuz). Kapsam kuralları `buildTenantContext` ile aynı; zorlama açıksa fail-closed. */
export async function buildScheduledTenantContext(
  db: Db,
  input: { tenantId: string; userId: string; role: string; officeName: string; enforced: boolean; sample: ReportContext["sample"] },
  nowMs: number,
): Promise<ReportContext> {
  const perms = await loadPerms(db, input.tenantId, input.userId, input.role, nowMs);
  const officeWide = hasOfficeWideDataScope(input.role);
  const listScope: ReportContext["listScope"] =
    !officeWide || (input.enforced && input.role !== "owner") ? { kind: "self", userId: input.userId } : { kind: "none" };
  return {
    scope: "tenant",
    supabase: db as ReportDb,
    tenantId: input.tenantId,
    userId: input.userId,
    role: input.role,
    officeWide,
    seeAllEarnings: canSeeAllEarnings(perms),
    perms,
    listScope,
    officeName: input.officeName,
    sample: input.sample,
    names: new Map(),
    memo: new Map(),
  };
}

function composeMail(input: {
  def: ReportDef;
  sub: SubscriptionRow;
  recipientName: string;
  filters: Filters;
  ctx: ReportContext | null;
  dueKey: string;
  rendered: { rowCount: number; truncated: boolean; attached: boolean } | null;
  channelClosed: boolean;
  appUrl: string;
}): { subject: string; text: string } {
  const { def, sub, filters, dueKey } = input;
  const range = sub.relative_range && hasDateRange(def) ? periodRange(sub.frequency, dueKey) : null;
  const period = range ? (range.from === range.to ? dayTr(range.from) : `${dayTr(range.from)} – ${dayTr(range.to)}`) : dayTr(dueKey);
  const subject = `${def.title} · ${period}`;
  const summary = summarizeFilters(def, filters, input.ctx?.names);
  const link = `${input.appUrl}${reportCenterHref(def.scope, def.id, filters)}`;
  const lines = [input.recipientName.trim() ? `Merhaba ${input.recipientName.trim()},` : "Merhaba,", ""];
  if (input.channelClosed) {
    lines.push(`"${def.title}" raporu için zamanlanmış gönderim zamanı geldi; e-posta kanalı kapalı olduğundan dosya üretilmedi.`);
  } else if (input.rendered) {
    const fmt = REPORT_FORMAT_LABELS[sub.format];
    const rows = `${input.rendered.rowCount.toLocaleString("tr-TR")} satır${input.rendered.truncated ? " (satır sınırında kesildi)" : ""}`;
    lines.push(
      input.rendered.attached
        ? `"${def.title}" raporunuz ekte: ${fmt}, ${rows}.`
        : `"${def.title}" raporu e-posta eki için çok büyük (${rows}); aşağıdaki bağlantıdan rapor merkezinde indirebilirsiniz.`,
    );
  }
  lines.push("", `Dönem: ${period}`);
  if (summary.length) lines.push(`Filtreler: ${summary.map((s) => `${s.label}: ${s.value}`).join(" · ")}`);
  lines.push("", `Rapor merkezinde aç: ${link}`);
  if (def.personalData) lines.push("", "Bu rapor kişisel veri içerebilir (KVKK). Dosyayı yetkisiz kişilerle paylaşmayın.");
  lines.push("", `Bu e-postayı "${sub.name}" aboneliği nedeniyle alıyorsunuz. Aboneliği rapor merkezinden durdurabilirsiniz.`);
  return { subject, text: lines.join("\n") };
}

type Recipient = { id: string; name: string; role: string; email: string | null };

async function loadRecipients(db: Db, sub: SubscriptionRow, deps: DeliveryDeps): Promise<Recipient[]> {
  const ids = [...new Set((sub.recipient_ids ?? []).filter(Boolean))].slice(0, 10);
  if (ids.length === 0) return [];
  if (sub.scope === "tenant") {
    // Kiracı yalıtımı: alıcı YALNIZ aboneliğin ofisinin aktif kullanıcısı olabilir (başka ofisin kimliği sessizce düşer).
    const { data } = await db.from("profiles").select("id, full_name, role").eq("tenant_id", sub.tenant_id!).eq("is_active", true).in("id", ids);
    const rows = (data ?? []) as { id: string; full_name: string | null; role: string }[];
    return Promise.all(rows.map(async (r) => ({ id: r.id, name: r.full_name ?? "", role: r.role, email: await deps.userEmail(r.id) })));
  }
  const { data } = await db.from("platform_staff").select("id, full_name, role, email").eq("is_active", true).in("id", ids);
  return ((data ?? []) as { id: string; full_name: string | null; role: string; email: string | null }[]).map((r) => ({ id: r.id, name: r.full_name ?? "", role: r.role, email: r.email }));
}

async function deliverOne(db: Db, sub: SubscriptionRow, dueKey: string, deps: DeliveryDeps): Promise<Outcome> {
  const skip = (error: string): Outcome => ({ status: "skipped", recipients: 0, sent: 0, rows: 0, error });
  const def = getReport(sub.scope, sub.report_id);
  if (!def || !isSchedulable(def)) return skip("Rapor artık zamanlanamıyor.");
  const baseFilters = storedViewFilters(def, sub.filters);
  const filters = scheduledFilters(def, baseFilters, { frequency: sub.frequency, relativeRange: sub.relative_range }, dueKey);

  let tenant: TenantInfo | null = null;
  let platformCtx: ReportContext | null = null;
  let ownerRole = "";
  if (sub.scope === "tenant") {
    if (!sub.tenant_id || !sub.user_id) return skip("Abonelik sahibi yok.");
    const { data: owner } = await db.from("profiles").select("id, role").eq("id", sub.user_id).eq("tenant_id", sub.tenant_id).eq("is_active", true).maybeSingle();
    if (!owner) return skip("Abonelik sahibi artık bu ofiste aktif değil.");
    tenant = await loadTenantInfo(db, sub.tenant_id, def, deps);
    if (!tenant.ok) return skip(tenant.reason ?? "Ofis doğrulanamadı.");
  } else {
    if (!sub.staff_id) return skip("Abonelik sahibi yok.");
    const { data: owner } = await db.from("platform_staff").select("id, role").eq("id", sub.staff_id).eq("is_active", true).maybeSingle();
    const role = (owner as { role?: string } | null)?.role as PlatformRole | undefined;
    if (!role || !platformCanAccess(role, "reports") || !platformReportAllowed(def, role)) return skip("Abonelik sahibinin bu rapora yetkisi yok.");
    ownerRole = role;
  }

  const recipients = await loadRecipients(db, sub, deps);
  if (recipients.length === 0) return skip("Geçerli alıcı yok.");

  const channel = await deps.channel();
  if (!channel.enabled) {
    // Kanal kapalı: rapor ÜRETİLMEZ; AD7 günlüğüne her alıcı için 'disabled' kaydı düşer (sahte gönderim yok).
    for (const r of recipients) {
      if (!r.email) continue;
      const mail = composeMail({ def, sub, recipientName: r.name, filters, ctx: null, dueKey, rendered: null, channelClosed: true, appUrl: deps.appUrl });
      await deps.send({ to: r.email, ...mail, template: TEMPLATE, source: SOURCE, tenantId: sub.tenant_id, actorId: sub.staff_id });
    }
    return { status: "channel_disabled", recipients: recipients.length, sent: 0, rows: 0, error: short(channel.reason ?? "E-posta kanalı kapalı") };
  }

  let sent = 0;
  let eligible = 0;
  let rows = 0;
  let lastError: string | null = null;
  let platformRender: RenderResult | null = null;
  for (const r of recipients) {
    if (deps.shouldStop?.()) {
      lastError = "Süre bütçesi doldu; kalan alıcılar atlandı.";
      break;
    }
    if (!r.email) {
      lastError = "Alıcının e-posta adresi bulunamadı.";
      continue;
    }
    let ctx: ReportContext;
    let rendered: RenderResult;
    if (sub.scope === "tenant") {
      const rctx = await buildScheduledTenantContext(
        db,
        { tenantId: sub.tenant_id!, userId: r.id, role: r.role, officeName: tenant!.name, enforced: tenant!.enforced, sample: tenant!.sample! },
        deps.nowMs,
      );
      const allowed =
        effectiveHasPermission(rctx.perms, "reports", "view") &&
        tenantReportAllowed(def, { perms: rctx.perms, role: r.role, officeWide: rctx.officeWide, seeAllEarnings: rctx.seeAllEarnings });
      if (!allowed) {
        lastError = "Bazı alıcıların bu rapora yetkisi yok.";
        continue;
      }
      ctx = rctx;
      rendered = await deps.render({ format: sub.format, def, ctx, filters, generatedBy: "Zamanlanmış rapor" });
      if (rendered.ok && r.role !== "owner" && r.role !== "gm") {
        // Ofis kontrol: toplu dışa aktarma onayı açıksa cron onay isteyemez; muaf olmayan alıcıya gönderilmez.
        if (tenant!.rulesError) {
          lastError = "Ofis onay kuralları okunamadı.";
          continue;
        }
        const decision = evaluateApprovalRule(tenant!.rules!, "bulk_export", { rows: rendered.total, exportEntity: def.id, channel: "full" });
        if (decision.required) {
          lastError = "Ofiste toplu dışa aktarma onayı gerekiyor; onaydan muaf olmayan alıcıya gönderilmedi.";
          continue;
        }
      }
    } else {
      if (!platformCanAccess(r.role as PlatformRole, "reports") || !platformReportAllowed(def, r.role as PlatformRole)) {
        lastError = "Bazı alıcıların bu rapora yetkisi yok.";
        continue;
      }
      platformCtx ??= deps.platformContext({ id: sub.staff_id!, role: ownerRole });
      ctx = platformCtx;
      // Platform verisi personel için aynıdır: tek kez üretilir.
      platformRender ??= await deps.render({ format: sub.format, def, ctx, filters, generatedBy: "Zamanlanmış rapor" });
      rendered = platformRender;
    }
    eligible += 1;
    if (!rendered.ok) {
      lastError = rendered.error;
      continue;
    }
    rows = Math.max(rows, rendered.rowCount);
    const attached = rendered.body.byteLength <= deps.attachmentMaxBytes;
    const mail = composeMail({ def, sub, recipientName: r.name, filters, ctx, dueKey, rendered: { rowCount: rendered.rowCount, truncated: rendered.truncated, attached }, channelClosed: false, appUrl: deps.appUrl });
    const res = await deps.send({
      to: r.email,
      ...mail,
      attachments: attached ? [{ filename: rendered.filename, content: rendered.body }] : undefined,
      template: TEMPLATE,
      source: SOURCE,
      tenantId: sub.tenant_id,
      actorId: sub.staff_id,
    });
    if (res.ok) {
      sent += 1;
      await deps.audit({
        scope: sub.scope,
        tenantId: sub.tenant_id,
        actorId: sub.user_id ?? sub.staff_id!,
        def,
        subscriptionId: sub.id,
        value: { report: def.id, title: def.title, format: sub.format, rows: rendered.rowCount, total: rendered.total, truncated: rendered.truncated, recipient: r.id, attached, period: dueKey },
      });
    } else {
      lastError = res.error;
    }
  }
  const status: RunStatus = eligible === 0 ? "skipped" : sent === eligible && sent === recipients.length ? "sent" : sent > 0 ? "partial" : "failed";
  return { status, recipients: recipients.length, sent, rows, error: short(status === "sent" ? null : lastError) };
}

const SELECT =
  "id, scope, tenant_id, user_id, staff_id, report_id, name, filters, relative_range, format, frequency, weekday, month_day, recipient_ids, next_run_at";

/** Zamanı gelmiş abonelikleri teslim eder. `db`: çağıran cron'un servis istemcisi. */
export async function runReportSubscriptionDelivery(db: Db, deps: DeliveryDeps): Promise<DeliverySummary> {
  const out: DeliverySummary = { due: 0, processed: 0, sent: 0, channelDisabled: 0, failed: 0, skipped: 0, schemaMissing: false };
  const nowIso = new Date(deps.nowMs).toISOString();
  const { data, error } = await db
    .from("report_subscriptions")
    .select(SELECT)
    .eq("active", true)
    .lte("next_run_at", nowIso)
    .order("next_run_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(DELIVERY_BATCH);
  if (error) {
    if (MISSING.has(String(error.code))) out.schemaMissing = true;
    else out.failed += 1;
    return out;
  }
  const subs = (data ?? []) as SubscriptionRow[];
  out.due = subs.length;
  const todayKey = trKeyOf(deps.nowMs);

  for (const sub of subs) {
    if (deps.shouldStop?.()) break;
    const dueKey = trKeyOf(Date.parse(sub.next_run_at));
    const spec: ScheduleSpec = { frequency: sub.frequency, weekday: sub.weekday, monthDay: sub.month_day };
    // Kesintiden sonra geçmiş dönemler birikmez: bir sonraki teslim bugünden SONRAKİ ilk uygun gün.
    const nextIso = runDayStartIso(nextRunDay(spec, dueKey > todayKey ? dueKey : todayKey));

    // Dönem başına TEK teslim: günlük satırı tekil (abonelik, dönem). Zaten varsa yalnız zaman ilerler.
    const claim = await db
      .from("report_subscription_runs")
      .upsert({ subscription_id: sub.id, tenant_id: sub.tenant_id, period_key: dueKey, status: "running" }, { onConflict: "subscription_id,period_key", ignoreDuplicates: true })
      .select("id");
    if (claim.error) {
      out.failed += 1;
      continue;
    }
    const runId = ((claim.data ?? []) as { id: string }[])[0]?.id ?? null;
    let outcome: Outcome | null = null;
    if (runId) {
      try {
        outcome = await deliverOne(db, sub, dueKey, deps);
      } catch (e) {
        console.error("report-subscription", sub.id, e instanceof Error ? e.message : e);
        outcome = { status: "failed", recipients: 0, sent: 0, rows: 0, error: "Beklenmeyen hata." };
      }
      await db
        .from("report_subscription_runs")
        .update({ status: outcome.status, recipients: outcome.recipients, sent: outcome.sent, row_count: outcome.rows, error: outcome.error, finished_at: new Date(deps.nowMs).toISOString() })
        .eq("id", runId);
      out.processed += 1;
      if (outcome.status === "sent" || outcome.status === "partial") out.sent += 1;
      if (outcome.status === "partial" || outcome.status === "failed") out.failed += 1;
      if (outcome.status === "channel_disabled") out.channelDisabled += 1;
      if (outcome.status === "skipped") out.skipped += 1;
    }
    await db
      .from("report_subscriptions")
      .update({
        next_run_at: nextIso,
        updated_at: new Date(deps.nowMs).toISOString(),
        ...(outcome ? { last_run_at: new Date(deps.nowMs).toISOString(), last_status: outcome.status, last_error: outcome.error } : {}),
      })
      .eq("id", sub.id);
  }
  return out;
}
