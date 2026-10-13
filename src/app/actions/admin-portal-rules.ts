"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformModule } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { now } from "@/lib/clock";
import { getSettings } from "@/lib/settings/read";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { TRANSFER_PORTALS } from "@/lib/portal-transfer/rules";
import { validateRuleSet } from "@/lib/portal-transfer/rule-format";
import { seedRuleSet } from "@/lib/portal-transfer/seed-rules";
import { applyProposals } from "@/lib/portal-transfer/rule-apply";
import { suggestPortalRules } from "@/lib/portal-rules/server/ai-suggest";
import { needsPiiAck, withVersion } from "@/lib/portal-rules/admin-model";

/**
 * Yönetim > Sistem > Portal kuralları eylemleri. KAPI: her eylem `requirePlatformModule("sistem")` (super_admin + ops);
 * yayın üreten eylemler (onay, geri alma, tohum) yalnız super_admin (K1). Veri yolu OTURUMLU istemci + SECURITY DEFINER
 * RPC'ler (rol kapısı ve denetim kaydı SQL'de, P1); `createAdminClient` YOK (allowlist değişmez).
 * Bozuk içerik yayına giremez: onay ve tohum TS'te `validateRuleSet`'ten geçmeden RPC çağrılmaz; geri alma da hedef
 * içeriği bugünkü doğrulayıcıyla yeniden doğrular (N3).
 */

export type PortalRulesResult = { ok?: boolean; error?: string; notice?: string; version?: number };

const PATH = "/admin/sistem";
const SCHEMA_PENDING = "Sistem güncellemesi bekleniyor: portal kuralları tabloları henüz kurulmadı.";
const SUPER_ONLY = "Kural yayını ve geri alma yalnız süper admin tarafından yapılabilir.";

const portalSchema = z.enum(TRANSFER_PORTALS);
const reasonSchema = z.string().trim().min(3, "Gerekçe en az 3 karakter olmalı.").max(500, "Gerekçe en çok 500 karakter olabilir.");

type DbError = { code?: string | null; message?: string | null } | null | undefined;

function dbError(error: DbError, subject: string): string {
  if (isMissingSchema(error)) return SCHEMA_PENDING;
  const msg = String(error?.message ?? "");
  if (/forbidden|permission denied|42501/i.test(msg) || error?.code === "42501") return "Bu işlem için yetkiniz yok.";
  if (/version|23505|duplicate/i.test(msg) || error?.code === "23505") return `${subject}: sürüm çakıştı, sayfayı yenileyip tekrar deneyin.`;
  return `${subject} yapılamadı.`;
}

function issuedAtIso(): string {
  return new Date(now()).toISOString();
}

/** Yanıttan sürüm numarası (RPC int ya da {version} döndürebilir). */
function versionOf(data: unknown): number | undefined {
  if (typeof data === "number" && Number.isFinite(data)) return data;
  if (data && typeof data === "object") {
    const v = (data as { version?: unknown }).version;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function refresh() {
  revalidatePath(PATH);
}

type Db = Awaited<ReturnType<typeof createClient>>;

async function maxVersion(db: Db, portal: string): Promise<{ version: number } | { error: string }> {
  const { data, error } = await db.from("portal_rule_sets").select("version").eq("portal", portal).order("version", { ascending: false }).limit(1);
  if (error) return { error: dbError(error, "Sürüm okuma") };
  const v = (data?.[0] as { version?: number } | undefined)?.version;
  return { version: typeof v === "number" ? v : 0 };
}

/**
 * P1 `applyProposals` sonucunu biçimden bağımsız okur ({ok,content,changeSummary} ya da hata). Fırlatırsa hata sayılır.
 * Sonuç ne olursa olsun yayından önce aşağıda `validateRuleSet` YENİDEN çalışır.
 */
function runApply(content: unknown, proposal: Record<string, unknown>): { ok: true; content: unknown; summary: unknown } | { ok: false; reason: string } {
  try {
    const r = (applyProposals as unknown as (c: unknown, p: unknown[], o: { maxChanges: number }) => unknown)(content, [proposal], { maxChanges: 5 });
    if (!r || typeof r !== "object") return { ok: false, reason: "boş sonuç" };
    const o = r as Record<string, unknown>;
    if (o.ok === false) return { ok: false, reason: String(o.reason ?? o.error ?? "bilinmeyen neden") };
    const next = o.content ?? o.set;
    if (!next) return { ok: false, reason: "içerik yok" };
    return { ok: true, content: next, summary: o.changeSummary ?? o.change_summary ?? o.summary ?? [] };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

const decideSchema = z.object({
  proposalId: z.string().uuid("Öneri bulunamadı."),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500, "Gerekçe en çok 500 karakter olabilir.").optional().default(""),
  noPersonalData: z.boolean().optional().default(false),
});

/**
 * Öneri kararı. Onay: yayındaki içerik + öneri → applyProposals → validateRuleSet → pt_rules_admin_publish → öneri
 * approved. Ret: pt_rules_admin_decide (gerekçe zorunlu). Onayda bozuk içerik çıkarsa HİÇBİR yazma yapılmaz.
 */
export async function decideProposal(input: z.input<typeof decideSchema>): Promise<PortalRulesResult> {
  const staff = await requirePlatformModule("sistem");
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Geçersiz istek." };
  const { proposalId, decision, reason, noPersonalData } = parsed.data;
  const db = await createClient();

  if (decision === "reject") {
    const r = reasonSchema.safeParse(reason);
    if (!r.success) return { error: "Reddetmek için gerekçe yazın (en az 3 karakter)." };
    const { error } = await db.rpc("pt_rules_admin_decide", { p_proposal_id: proposalId, p_decision: "rejected", p_reason: r.data });
    if (error) return { error: dbError(error, "Ret") };
    refresh();
    return { ok: true, notice: "Öneri reddedildi." };
  }

  if (staff.role !== "super_admin") return { error: SUPER_ONLY };

  const { data: proposal, error: pErr } = await db
    .from("portal_rule_proposals")
    .select("id, portal, proposal_key, kind, field_key, field_sig, proposal, source, support_tenants, state, ai_unverified")
    .eq("id", proposalId)
    .maybeSingle();
  if (pErr) return { error: dbError(pErr, "Öneri okuma") };
  if (!proposal) return { error: "Öneri bulunamadı." };
  const p = proposal as Record<string, unknown> & { portal: string; kind: string; state: string; support_tenants: number | null };
  if (p.state !== "ready" && p.state !== "collecting") return { error: "Bu öneri artık karar beklemiyor." };
  if (needsPiiAck(p.kind, p.support_tenants) && !noPersonalData) {
    return { error: "Bu öneri tek ofisten geliyor. Onaylamadan önce metnin kişisel veri içermediğini teyit edin." };
  }

  const [{ data: current, error: cErr }, max] = await Promise.all([
    db.from("portal_rule_sets").select("id, version, content").eq("portal", p.portal).eq("status", "published").maybeSingle(),
    maxVersion(db, p.portal),
  ]);
  if (cErr) return { error: dbError(cErr, "Yayındaki set okuma") };
  if (!current) return { error: "Bu portalda yayında kural seti yok. Önce tohumu yayınlayın." };
  if ("error" in max) return { error: max.error };

  const applied = runApply((current as { content: unknown }).content, p);
  if (!applied.ok) return { error: `Öneri uygulanamadı, yayın yapılmadı (${applied.reason}).` };
  const nextVersion = max.version + 1;
  const candidate = withVersion(applied.content as Record<string, unknown>, nextVersion, issuedAtIso());
  const valid = validateRuleSet(candidate);
  if (!valid.ok) return { error: `Öneri bozuk bir kural seti üretiyor, yayın yapılmadı (${valid.reason}).` };

  const { data: pub, error: pubErr } = await db.rpc("pt_rules_admin_publish", {
    p_portal: p.portal,
    p_content: valid.set,
    p_kind: "staff",
    p_parent: (current as { id: string }).id,
    p_change_summary: applied.summary,
  });
  if (pubErr) return { error: dbError(pubErr, "Yayın") };

  const { error: dErr } = await db.rpc("pt_rules_admin_decide", {
    p_proposal_id: proposalId,
    p_decision: "approved",
    p_reason: reason ? reason : "Personel onayı",
  });
  refresh();
  const version = versionOf(pub) ?? nextVersion;
  if (dErr) return { ok: true, version, notice: `Sürüm ${version} yayınlandı; öneri durumu güncellenemedi (${dbError(dErr, "Karar")}).` };
  return { ok: true, version, notice: `Onaylandı, sürüm ${version} yayınlandı.` };
}

const rollbackSchema = z.object({ portal: portalSchema, version: z.number().int().min(1).max(2_147_483_647) });

/** Eski bir sürümün içeriğiyle YENİ (max+1) sürüm üretir. Hedef içerik bugünkü doğrulayıcıdan geçmezse geri alma yapılmaz. */
export async function rollbackTo(portal: string, version: number): Promise<PortalRulesResult> {
  const staff = await requirePlatformModule("sistem");
  const parsed = rollbackSchema.safeParse({ portal, version });
  if (!parsed.success) return { error: "Geçersiz sürüm." };
  if (staff.role !== "super_admin") return { error: SUPER_ONLY };
  const db = await createClient();

  const { data: target, error: tErr } = await db
    .from("portal_rule_sets")
    .select("id, version, status, content")
    .eq("portal", parsed.data.portal)
    .eq("version", parsed.data.version)
    .maybeSingle();
  if (tErr) return { error: dbError(tErr, "Sürüm okuma") };
  if (!target) return { error: "Sürüm bulunamadı." };
  const t = target as { status: string; content: unknown };
  if (t.status === "published") return { error: "Bu sürüm zaten yayında." };
  const valid = validateRuleSet(t.content);
  if (!valid.ok) return { error: `Bu sürümün içeriği bugünkü doğrulamadan geçmiyor, geri dönülemez (${valid.reason}).` };

  const { data, error } = await db.rpc("pt_rules_admin_rollback", { p_portal: parsed.data.portal, p_to_version: parsed.data.version });
  if (error) return { error: dbError(error, "Geri alma") };
  refresh();
  const v = versionOf(data);
  return { ok: true, version: v, notice: v ? `Sürüm ${parsed.data.version} içeriği sürüm ${v} olarak yayınlandı.` : "Geri alma yayınlandı." };
}

/** Tohum (paket içi varsayılan kurallar) → sürüm 1. Yalnız portalda HİÇ set yokken. */
export async function publishSeed(portal: string): Promise<PortalRulesResult> {
  const staff = await requirePlatformModule("sistem");
  const parsed = portalSchema.safeParse(portal);
  if (!parsed.success) return { error: "Geçersiz portal." };
  if (staff.role !== "super_admin") return { error: SUPER_ONLY };
  const db = await createClient();

  const { count, error: cErr } = await db.from("portal_rule_sets").select("id", { count: "exact", head: true }).eq("portal", parsed.data);
  if (cErr) return { error: dbError(cErr, "Set okuma") };
  if ((count ?? 0) > 0) return { error: "Bu portalda zaten kural seti var; tohum yalnız ilk sürüm için yayınlanır." };

  const candidate = withVersion(seedRuleSet(parsed.data) as unknown as Record<string, unknown>, 1, issuedAtIso());
  const valid = validateRuleSet(candidate);
  if (!valid.ok) return { error: `Tohum içeriği doğrulamadan geçmedi (${valid.reason}).` };

  const { data, error } = await db.rpc("pt_rules_admin_publish", {
    p_portal: parsed.data,
    p_content: valid.set,
    p_kind: "seed",
    p_parent: null,
    p_change_summary: { seed: true },
  });
  if (error) return { error: dbError(error, "Tohum yayını") };
  refresh();
  const v = versionOf(data) ?? 1;
  return { ok: true, version: v, notice: `Tohum sürüm ${v} olarak yayınlandı.` };
}

const trustSchema = z.object({
  tenantId: z.string().uuid("Ofis bulunamadı."),
  eligible: z.boolean(),
  reason: reasonSchema,
});

/** Ofisin öğrenmeye katılımı (uygun / dışla). Gerekçe zorunlu; denetim kaydı RPC'de. */
export async function setTenantTrust(input: z.input<typeof trustSchema>): Promise<PortalRulesResult> {
  await requirePlatformModule("sistem");
  const parsed = trustSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Geçersiz istek." };
  const db = await createClient();
  const { error } = await db.rpc("pt_rules_admin_set_trust", {
    p_tenant_id: parsed.data.tenantId,
    p_eligible: parsed.data.eligible,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: dbError(error, "Uygunluk") };
  refresh();
  return { ok: true, notice: parsed.data.eligible ? "Ofis öğrenmeye dahil edildi." : "Ofis öğrenmeden dışlandı." };
}

/** AI önerisi üret: portal başına 10 dakikada 1 (altyapı yoksa REDDET). Öneriler `ai_unverified` olarak düşer, kendiliğinden onaylanmaz. */
export async function runAiSuggest(portal: string): Promise<PortalRulesResult> {
  const staff = await requirePlatformModule("sistem");
  const parsed = portalSchema.safeParse(portal);
  if (!parsed.success) return { error: "Geçersiz portal." };

  const rl = await checkRateLimit(`pt-ai:${parsed.data}`, { limit: 1, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Bu portal için AI önerisi 10 dakikada bir üretilebilir. Biraz sonra tekrar deneyin." };

  const db = await createClient();
  let r: unknown;
  try {
    r = await (suggestPortalRules as unknown as (i: { db: Db; portal: string; actorId: string }) => Promise<unknown>)({ db, portal: parsed.data, actorId: staff.id });
  } catch (e) {
    console.error("runAiSuggest", e);
    return { error: "AI önerisi üretilemedi." };
  }
  const o = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
  const reason = String(o.reason ?? o.error ?? "");
  if (/insufficient|yetersiz|no_input|empty/i.test(reason) || o.insufficient === true) {
    const fromResult = typeof o.minTenants === "number" ? o.minTenants : typeof o.min_tenants === "number" ? o.min_tenants : null;
    const fromSetting = fromResult ?? Number((await getSettings(["portal_rules.ai_min_tenants"]).catch(() => ({})) as Record<string, unknown>)["portal_rules.ai_min_tenants"]);
    const n = Number.isFinite(fromSetting) && fromSetting > 0 ? fromSetting : 2;
    return { ok: false, error: `Yetersiz veri (en az ${n} ofiste görülen eşleşmemiş alan yok).` };
  }
  if (/schema|missing/i.test(reason)) return { error: SCHEMA_PENDING };
  if (o.ok === false) return { error: "AI önerisi üretilemedi." };
  refresh();
  const n = [o.inserted, o.proposals, o.count].find((v): v is number => typeof v === "number");
  return { ok: true, notice: n != null ? `${n} AI önerisi eklendi (doğrulanmamış).` : "AI önerileri eklendi (doğrulanmamış)." };
}
