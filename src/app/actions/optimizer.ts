"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { afterSafe } from "@/lib/after-safe";
import { now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { HOOKS, captureLiveDigests, lastBaseline, runAfterPublish } from "@/lib/publishing/after-publish";
import { diffJson, moreLabel, previewValue, type DiffKind } from "@/lib/publishing/diff";
import { hashOf } from "@/lib/publishing/schedule";
import { SURFACES, resolveSurface, surfaceById } from "@/lib/publishing/surfaces";
import { AUTOPILOT_KINDS, type AutopilotSettings } from "@/lib/site-issues/autopilot";
import { readAutopilot, writeAutopilot } from "@/lib/site-issues/autopilot-server";
import { syncSiteIssues, type SyncStep } from "@/lib/site-issues/collectors";
import { EXECUTORS, IGNORE_REASON_MIN, canDraft, executorFor } from "@/lib/site-issues/executors";
import { hasPendingDraft, publishDraftsSequential, type PublishAllItem } from "@/lib/site-issues/publish-all";
import { patchIssue, readIssuesByIds, readQueueIssues, recordOptimizerAction } from "@/lib/site-issues/store";
import { ACTIVE_STATUSES } from "@/lib/site-issues/state";
import { ISSUE_LIMITS, type PlannedFix, type SiteIssue } from "@/lib/site-issues/types";

/**
 * BÜYÜME KOKPİTİ eylemleri (/admin/site). Yetki: her eylem `requirePlatformModule("seo")` (süper admin + operasyon);
 * yayın (`publishAllDrafts`) ve Otopilot (`setAutopilot`) YALNIZ süper admin. AI çağrısı YOK. Girdiler zod ile doğrulanır,
 * her yazma `logPlatformActivity` ve `site_optimizer_actions`'a düşer.
 */

export type OptimizerResult = { ok?: boolean; error?: string };
export type AuditResult = OptimizerResult & { steps?: SyncStep[] };
export type PlanRow = { issueId: string; kind: string; target: string; summary: string; before: string | null; after: string | null };
export type PrepareResult = OptimizerResult & { plans?: PlanRow[]; applied?: ApplyRow[] };
export type ApplyRow = { issueId: string; ok: boolean; message: string; before: string | null; after: string | null; target: string };
export type PublishAllResult = OptimizerResult & { items?: PublishAllItem[] };
export type DraftDiffGroup = { surface: string; label: string; hash: string; rows: { path: string; kind: DiffKind; before: string; after: string }[]; total: number; more: string };
export type AllDraftsPreview = OptimizerResult & { groups?: DraftDiffGroup[] };

const SUPER_ONLY = "Bu işlemi yalnız süper admin yapabilir; bu hesap salt okunur.";
const TOO_FAST = "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin.";

async function gate(superOnly: boolean) {
  const staff = await requirePlatformModule("seo");
  if (superOnly && staff.role !== "super_admin") return { error: SUPER_ONLY } as const;
  return { staff } as const;
}

const refresh = () => revalidatePath("/admin/site");

/* ---------- Denetim ---------- */

const auditSchema = z.object({ collector: z.string().trim().min(1).max(ISSUE_LIMITS.collector).optional() }).optional();

/** "Siteyi şimdi denetle": toplayıcıları çalıştırır (istemci satır satır ilerleme için toplayıcı başına çağırır). */
export async function runSiteAudit(input?: { collector?: string }): Promise<AuditResult> {
  const g = await gate(false);
  if ("error" in g) return { error: g.error };
  const parsed = auditSchema.safeParse(input);
  if (!parsed.success) return { error: "Geçersiz denetim isteği." };
  const rl = await checkRateLimit(`optimizer-audit:${g.staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: TOO_FAST };
  const only = parsed.data?.collector ? [parsed.data.collector] : undefined;
  const steps = await syncSiteIssues("audit", { only, source: "staff", actor: g.staff.id });
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "optimizer.audit",
    entityType: "site_issues",
    entityId: only?.[0] ?? "all",
    meta: { steps: steps.map((s) => ({ c: s.collector, ok: s.ok, pending: Boolean(s.pending) })) },
  });
  refresh();
  return { ok: true, steps };
}

/* ---------- Güvenli düzeltmeler ---------- */

async function planFor(issue: SiteIssue): Promise<PlannedFix | null> {
  if (!canDraft(issue)) return null;
  const ex = executorFor(issue.proposal?.kind, EXECUTORS);
  if (!ex || ex.risk !== "guvenli" || !ex.plan) return null;
  try {
    const plan = await ex.plan(issue);
    return plan && plan.risk === "guvenli" ? plan : null;
  } catch {
    return null;
  }
}

const toRow = (p: PlannedFix): PlanRow => ({ issueId: p.issueId, kind: p.kind, target: p.target, summary: p.summary, before: p.before, after: p.after });

async function applyPlans(plans: PlannedFix[], actorId: string): Promise<ApplyRow[]> {
  const out: ApplyRow[] = [];
  for (const plan of plans) {
    const ex = executorFor(plan.kind, EXECUTORS);
    if (!ex?.apply) {
      out.push({ issueId: plan.issueId, ok: false, message: "Bu düzeltmenin yürütücüsü bağlı değil.", before: plan.before, after: plan.after, target: plan.target });
      continue;
    }
    try {
      const res = await ex.apply(plan, { actorId, source: "staff" });
      await recordOptimizerAction({
        kind: plan.kind,
        source: "staff",
        target: plan.target,
        status: res.ok ? "hazirlandi" : "hata",
        before: { value: res.before ?? plan.before, issueId: plan.issueId },
        after: { value: res.after ?? plan.after, message: res.message, draftSurface: res.draftSurface ?? null },
        actor: actorId,
      });
      if (res.ok && res.status) await patchIssue(plan.issueId, { status: res.status, publish_ref: res.publishRef ?? null });
      out.push({ issueId: plan.issueId, ok: res.ok, message: res.message, before: res.before ?? plan.before, after: res.after ?? plan.after, target: plan.target });
    } catch (e) {
      out.push({ issueId: plan.issueId, ok: false, message: e instanceof Error ? e.message.slice(0, 160) : "Uygulanamadı.", before: plan.before, after: plan.after, target: plan.target });
    }
  }
  return out;
}

/**
 * "Güvenli düzeltmeleri hazırla": önce KURU çalışma (K2 `plan()`), liste döner. `dryRun=false` listedeki tüm
 * güvenli düzeltmeleri uygular (taslağa alır); arayüz seçim için `applyFixes(ids)` kullanır.
 */
export async function prepareSafeFixes(dryRun: boolean): Promise<PrepareResult> {
  const g = await gate(false);
  if ("error" in g) return { error: g.error };
  if (typeof dryRun !== "boolean") return { error: "Geçersiz istek." };
  const queue = await readQueueIssues();
  if (!queue.available) return { error: "Kokpit tabloları henüz kurulmadı (kurulum bekliyor)." };
  const candidates = queue.data.filter((i) => ACTIVE_STATUSES.includes(i.status) && i.status !== "taslakta" && i.status !== "yayinda");
  const plans = (await Promise.all(candidates.map(planFor))).filter((p): p is PlannedFix => p !== null);
  await recordOptimizerAction({ kind: "prepare", source: "staff", target: "", dryRun: true, status: "plan", after: { count: plans.length }, actor: g.staff.id });
  if (dryRun) return { ok: true, plans: plans.map(toRow) };
  const applied = await applyPlans(plans, g.staff.id);
  await logPlatformActivity({ actorId: g.staff.id, action: "optimizer.apply", entityType: "site_issues", entityId: "safe", meta: { planned: plans.length, ok: applied.filter((a) => a.ok).length } });
  refresh();
  return { ok: true, plans: plans.map(toRow), applied };
}

const idsSchema = z.array(z.uuid()).min(1).max(50);

/** Seçilen bulgular için `apply()` (taslağa al). Yalnız güvenli ve otomatik düzeltmeye açık bulgular. */
export async function applyFixes(ids: string[]): Promise<PrepareResult> {
  const g = await gate(false);
  if ("error" in g) return { error: g.error };
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { error: "Geçersiz seçim." };
  const rl = await checkRateLimit(`optimizer-apply:${g.staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: TOO_FAST };
  const issues = await readIssuesByIds(parsed.data);
  const plans = (await Promise.all(issues.map(planFor))).filter((p): p is PlannedFix => p !== null);
  if (!plans.length) return { error: "Seçilen bulgular için otomatik hazırlanabilen güvenli düzeltme yok." };
  const applied = await applyPlans(plans, g.staff.id);
  await logPlatformActivity({ actorId: g.staff.id, action: "optimizer.apply", entityType: "site_issues", entityId: "selected", meta: { requested: parsed.data.length, ok: applied.filter((a) => a.ok).length } });
  refresh();
  return { ok: true, applied };
}

const ignoreSchema = z.object({ id: z.uuid(), reason: z.string().trim().min(IGNORE_REASON_MIN).max(ISSUE_LIMITS.reason) });

/** Gerekçeli yoksayma (gerekçe zorunlu). Durum makinesi: açık işler -> "yoksayildi". */
export async function ignoreIssue(id: string, reason: string): Promise<OptimizerResult> {
  const g = await gate(false);
  if ("error" in g) return { error: g.error };
  const parsed = ignoreSchema.safeParse({ id, reason });
  if (!parsed.success) return { error: `Yoksaymak için en az ${IGNORE_REASON_MIN} karakterlik bir gerekçe yazın.` };
  const ok = await patchIssue(
    parsed.data.id,
    { status: "yoksayildi", ignored_by: g.staff.id, ignored_reason: parsed.data.reason, resolved_at: new Date(now()).toISOString() },
    ACTIVE_STATUSES,
  );
  if (!ok) return { error: "Bulgu bulunamadı ya da zaten kapanmış." };
  await recordOptimizerAction({ kind: "ignore", source: "staff", target: parsed.data.id, status: "ok", after: { reason: parsed.data.reason }, actor: g.staff.id });
  await logPlatformActivity({ actorId: g.staff.id, action: "optimizer.ignore", entityType: "site_issue", entityId: parsed.data.id, meta: { reason: parsed.data.reason } });
  refresh();
  return { ok: true };
}

/* ---------- Otopilot ---------- */

const autopilotSchema = z.object({
  enabled: z.boolean(),
  publish: z.boolean().optional(),
  kinds: z.array(z.enum(AUTOPILOT_KINDS)).max(AUTOPILOT_KINDS.length).optional(),
});

/** Otopilot anahtarı (yalnız süper admin). Açan kişi kaydedilir: Otopilot yayınları onun adına geçmişe düşer. */
export async function setAutopilot(input: { enabled: boolean; publish?: boolean; kinds?: string[] }): Promise<OptimizerResult> {
  const g = await gate(true);
  if ("error" in g) return { error: g.error };
  const parsed = autopilotSchema.safeParse(input);
  if (!parsed.success) return { error: "Geçersiz Otopilot ayarı." };
  const current = await readAutopilot();
  const next: AutopilotSettings = {
    enabled: parsed.data.enabled,
    publish: parsed.data.publish ?? current.publish,
    kinds: parsed.data.kinds ?? current.kinds,
    enabledBy: parsed.data.enabled ? g.staff.id : null,
    enabledByName: parsed.data.enabled ? g.staff.full_name || g.staff.email : null,
  };
  if (!(await writeAutopilot(next, g.staff.id))) return { error: "Otopilot ayarı kaydedilemedi; tekrar deneyin." };
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "optimizer.autopilot",
    entityType: "platform_settings",
    entityId: "growth.autopilot",
    meta: { enabled: next.enabled, publish: next.publish, kinds: next.kinds },
  });
  refresh();
  return { ok: true };
}

/* ---------- Toplu yayın ---------- */

const surfaceSchema = z.string().trim().min(1).max(40);

const visibleSurfaces = (role: Parameters<typeof platformCanAccess>[0]) => SURFACES.filter((s) => platformCanAccess(role, s.module));

/** Tüm yüzeylerin bekleyen taslak farkları tek listede (mevcut fark motoru). Salt okuma. */
export async function previewAllDrafts(): Promise<AllDraftsPreview> {
  const g = await gate(false);
  if ("error" in g) return { error: g.error };
  const surfaces = visibleSurfaces(g.staff);
  const states = await Promise.all(surfaces.map((s) => s.readState()));
  const groups: DraftDiffGroup[] = [];
  surfaces.forEach((s, i) => {
    const st = states[i]!;
    if (!hasPendingDraft(st, s.defaults)) return;
    const d = diffJson(st.live ?? s.defaults(), st.draft, 60);
    groups.push({
      surface: s.id,
      label: s.label,
      hash: hashOf(st.draft),
      rows: d.rows.map((r) => ({ path: r.path, kind: r.kind, before: previewValue(r.before), after: previewValue(r.after) })),
      total: d.total,
      more: moreLabel(d.more),
    });
  });
  return { ok: true, groups };
}

const publishAllSchema = z
  .array(z.object({ surface: surfaceSchema, hash: z.string().trim().min(1).max(128) }))
  .min(1)
  .max(40);

/**
 * Önizlenen taslakları tek onayla SIRAYLA yayınlar; biri hata verirse diğerleri sürer (yalnız süper admin).
 * Girdi önizlemedeki {yüzey, taslak özeti} listesidir: önizlemeden sonra değişen ya da önizlemede olmayan taslak YAYINLANMAZ.
 */
export async function publishAllDrafts(input: { surface: string; hash: string }[]): Promise<PublishAllResult> {
  const g = await gate(true);
  if ("error" in g) return { error: g.error };
  const parsed = publishAllSchema.safeParse(input);
  if (!parsed.success) return { error: "Önizleme bilgisi geçersiz; farkları yeniden önizleyin." };
  const expected = Object.fromEntries(parsed.data.map((x) => [x.surface, x.hash]));
  const rl = await checkRateLimit(`publishing-all:${g.staff.id}`, { limit: 10, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: TOO_FAST };
  const surfaces = visibleSurfaces(g.staff);
  const items = await publishDraftsSequential(
    surfaces,
    { id: g.staff.id, name: g.staff.full_name || g.staff.email, source: "staff" },
    {
      label: "Toplu yayın (Kokpit)",
      expected,
      captureBefore: (paths) => captureLiveDigests(paths),
      onPublished: (ev) => afterSafe(() => runAfterPublish(ev), "yayın sonrası zinciri"),
    },
  );
  for (const it of items.filter((i) => !i.skipped)) {
    await recordOptimizerAction({ kind: "publish", source: "staff", target: it.surface, status: it.ok ? "yayinlandi" : "hata", after: { message: it.message }, actor: g.staff.id });
  }
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "publishing.publish_all",
    entityType: "publishing",
    entityId: "all",
    meta: { items: items.map((i) => ({ s: i.surface, ok: i.ok, skipped: Boolean(i.skipped) })) },
  });
  for (const it of items) {
    if (!it.ok || it.skipped) continue;
    const s = surfaceById(it.surface);
    if (!s) continue;
    updateTag(s.cacheTag);
    for (const p of s.livePaths) revalidatePath(p.path, p.type);
    revalidatePath(s.editorHref);
  }
  refresh();
  return { ok: true, items };
}

/** Yayın masası rozeti "Henüz yansımadı — tekrar dene": yalnız doğrulama kancasını yeniden çalıştırır. */
export async function recheckLive(surfaceId: string): Promise<OptimizerResult & { message?: string }> {
  const g = await gate(false);
  if ("error" in g) return { error: g.error };
  const parsed = surfaceSchema.safeParse(surfaceId);
  const s = parsed.success ? await resolveSurface(parsed.data) : null;
  if (!s) return { error: "Bilinmeyen yüzey." };
  const rl = await checkRateLimit(`optimizer-verify:${g.staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: TOO_FAST };
  // Taban: bu yüzeyin son yayınında kaydedilen yayın öncesi özet (başka yüzeyin ya da sonraki canlının özeti değil).
  const beforeDigests = await lastBaseline(s.id);
  const r = await runAfterPublish(
    { surface: s.id, kind: "publish", livePaths: s.livePaths.map((p) => p.path), actorId: g.staff.id, source: "staff", beforeDigests },
    { hooks: HOOKS.filter((h) => h.id === "verify") },
  );
  refresh();
  return { ok: r.ok, message: r.hooks[0]?.message };
}
