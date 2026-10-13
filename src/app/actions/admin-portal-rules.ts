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
import { applyProposals, type RuleProposal } from "@/lib/portal-transfer/rule-apply";
import { suggestPortalRules, type SuggestResult } from "@/lib/portal-rules/server/ai-suggest";
import { loadSigningKey, publishRuleSet, readPublished, rollbackRuleSet, type PublishResult, type SigningKey } from "@/lib/portal-rules/server/sign";
import { needsPiiAck } from "@/lib/portal-rules/admin-model";

/**
 * Yönetim > Sistem > Portal kuralları eylemleri. KAPI: her eylem `requirePlatformModule("sistem")` (super_admin + ops);
 * yayın üreten eylemler (onay, geri alma, tohum) yalnız super_admin (K1). Veri yolu OTURUMLU istemci + SECURITY DEFINER
 * RPC'ler (rol kapısı ve denetim kaydı SQL'de, P1); `createAdminClient` YOK (allowlist değişmez).
 * Yayın ve geri alma P1'in `publishRuleSet`/`rollbackRuleSet` yardımcılarıyla yapılır: damga (max+1, şimdi, 14 gün) →
 * `validateRuleSet` → sha → imza → RPC (sürüm çakışmasında bir kez yeniden dener). İmza anahtarı yoksa yayın yapılmaz.
 * RPC'ler reddi HATA değil `{outcome}` verisi olarak döndürür; her yanıtta `outcome === "ok"` aranır.
 */

export type PortalRulesResult = { ok?: boolean; error?: string; notice?: string; version?: number };

const PATH = "/admin/sistem";
const SCHEMA_PENDING = "Sistem güncellemesi bekleniyor: portal kuralları tabloları henüz kurulmadı.";
const SUPER_ONLY = "Kural yayını ve geri alma yalnız süper admin tarafından yapılabilir.";
const SIGNING_UNAVAILABLE =
  "Kural imzalama anahtarı bu ortamda tanımlı değil ya da paketteki açık anahtarla eşleşmiyor (PORTAL_RULES_SIGNING_KEY / PORTAL_RULES_SIGNING_KID). Yayın yapılmadı.";

const portalSchema = z.enum(TRANSFER_PORTALS);
const reasonSchema = z.string().trim().min(3, "Gerekçe en az 3 karakter olmalı.").max(500, "Gerekçe en çok 500 karakter olabilir.");

type DbError = { code?: string | null; message?: string | null } | null | undefined;

function dbError(error: DbError, subject: string): string {
  if (isMissingSchema(error)) return SCHEMA_PENDING;
  const msg = String(error?.message ?? "");
  if (/forbidden|permission denied|42501/i.test(msg) || error?.code === "42501") return "Bu işlem için yetkiniz yok.";
  return `${subject} yapılamadı.`;
}

/** RPC `outcome` (ve yayın yardımcısının `reason`) değerleri → Türkçe mesaj. Bilinmeyen değer genel mesaja düşer. */
const OUTCOME_TEXT: Record<string, string> = {
  forbidden: "Bu işlem için yetkiniz yok.",
  invalid_input: "İstek geçersiz.",
  not_found: "Kayıt bulunamadı.",
  already_decided: "Bu öneri için zaten karar verilmiş.",
  pii_confirmation_required: "Bu öneri tek ofisten geliyor. Onaylamadan önce metnin kişisel veri içermediğini teyit edin.",
  version_conflict: "Aynı anda başka bir sürüm yayınlandı; sayfayı yenileyip tekrar deneyin.",
  invalid_content: "Kural seti veritabanı doğrulamasından geçmedi.",
  invalid_signature: "Kural seti imzası geçersiz.",
  invalid_expiry: "Kural setinin geçerlilik süresi geçersiz.",
  invalid_parent: "Önceki sürüm bilgisi tutmuyor; sayfayı yenileyip tekrar deneyin.",
  content_mismatch: "Geri alınan içerik hedef sürümle aynı değil.",
};

function outcomeText(outcome: string | null | undefined, subject: string): string {
  const o = String(outcome ?? "");
  if (OUTCOME_TEXT[o]) return `${subject}: ${OUTCOME_TEXT[o]}`;
  if (/^rpc:(42P01|42883|PGRST20[0-9])/.test(o)) return SCHEMA_PENDING;
  if (/^rpc:42501/.test(o)) return OUTCOME_TEXT.forbidden;
  if (o.startsWith("invalid:") || o.startsWith("invalid_target:")) return `${subject}: içerik bugünkü doğrulamadan geçmiyor (${o.split(":").slice(1).join(":")}).`;
  return `${subject} yapılamadı${o ? ` (${o})` : ""}.`;
}

/** jsonb RPC yanıtındaki `outcome` (yoksa null). */
function outcomeOf(data: unknown): string | null {
  return data && typeof data === "object" && typeof (data as { outcome?: unknown }).outcome === "string" ? (data as { outcome: string }).outcome : null;
}

function signingKey(): SigningKey | null {
  const s = loadSigningKey();
  return s.ok ? s.key : null;
}

function refresh() {
  revalidatePath(PATH);
}

type RpcDb = Parameters<typeof publishRuleSet>[0];

function publishFailure(r: Extract<PublishResult, { ok: false }>, subject: string): string {
  return outcomeText(r.reason, subject);
}

const decideSchema = z.object({
  proposalId: z.string().uuid("Öneri bulunamadı."),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500, "Gerekçe en çok 500 karakter olabilir.").optional().default(""),
  noPersonalData: z.boolean().optional().default(false),
});

/**
 * Öneri kararı. Onay (P1 sözleşmesi sırasıyla): yayındaki içerik + öneri → applyProposals (yalnız TS, yazma yok; bozuksa
 * dur) → pt_rules_admin_decide(approve, p_pii_confirmed) → publishRuleSet({proposalIds}) (yayın öneriye rule_set_id
 * bağlar). Ret: pt_rules_admin_decide(reject, gerekçe zorunlu).
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
    const { data, error } = await db.rpc("pt_rules_admin_decide", { p_proposal_id: proposalId, p_decision: "reject", p_reason: r.data });
    if (error) return { error: dbError(error, "Ret") };
    if (outcomeOf(data) !== "ok") return { error: outcomeText(outcomeOf(data), "Ret") };
    refresh();
    return { ok: true, notice: "Öneri reddedildi." };
  }

  if (staff.role !== "super_admin") return { error: SUPER_ONLY };

  const { data: proposal, error: pErr } = await db
    .from("portal_rule_proposals")
    .select("id, portal, proposal_key, kind, field_key, field_sig, proposal, source, support_tenants, state, ai_unverified, confidence")
    .eq("id", proposalId)
    .maybeSingle();
  if (pErr) return { error: dbError(pErr, "Öneri okuma") };
  if (!proposal) return { error: "Öneri bulunamadı." };
  const p = proposal as Record<string, unknown> & { portal: string; kind: string; state: string; support_tenants: number | null };
  if (p.state !== "ready" && p.state !== "collecting") return { error: "Bu öneri artık karar beklemiyor." };
  const portal = portalSchema.safeParse(p.portal);
  if (!portal.success) return { error: "Öneri bulunamadı." };
  if (needsPiiAck(p.kind, p.support_tenants) && !noPersonalData) return { error: OUTCOME_TEXT.pii_confirmation_required };

  const key = signingKey();
  if (!key) return { error: SIGNING_UNAVAILABLE };

  let current: Awaited<ReturnType<typeof readPublished>>;
  try {
    current = await readPublished(db as unknown as RpcDb, portal.data);
  } catch (e) {
    return { error: dbError((e as { pg?: DbError }).pg, "Yayındaki set okuma") };
  }
  if (!current) return { error: "Bu portalda yayında kural seti yok. Önce tohumu yayınlayın." };

  const base = validateRuleSet(current.content, { portal: portal.data });
  if (!base.ok) return { error: `Yayındaki set bugünkü doğrulamadan geçmiyor, öneri uygulanamaz (${base.reason}).` };
  const ruleProposal: RuleProposal = {
    id: String(p.id),
    kind: p.kind as RuleProposal["kind"],
    field_key: (p.field_key ?? null) as RuleProposal["field_key"],
    source: p.source as RuleProposal["source"],
    proposal: p.proposal && typeof p.proposal === "object" ? (p.proposal as Record<string, unknown>) : {},
    confidence: typeof p.confidence === "number" ? p.confidence : null,
  };
  const applied = applyProposals(base.set, [ruleProposal], { maxChanges: 5 });
  if (!applied.ok) return { error: `Öneri uygulanamadı, yayın yapılmadı (${applied.reason}).` };

  const { data: dec, error: dErr } = await db.rpc("pt_rules_admin_decide", {
    p_proposal_id: proposalId,
    p_decision: "approve",
    p_reason: reason ? reason : "Personel onayı",
    p_pii_confirmed: noPersonalData,
  });
  if (dErr) return { error: dbError(dErr, "Onay") };
  if (outcomeOf(dec) !== "ok") return { error: outcomeText(outcomeOf(dec), "Onay") };

  const pub = await publishRuleSet(db as unknown as RpcDb, {
    portal: portal.data,
    content: applied.content,
    kind: "staff",
    parentId: current.id,
    changeSummary: applied.changeSummary,
    proposalIds: [proposalId],
    nowMs: now(),
    key,
  });
  refresh();
  if (!pub.ok) {
    return { error: `Öneri onaylandı ancak yeni sürüm YAYINLANMADI: ${publishFailure(pub, "Yayın")} Öneri "onaylandı" durumunda kaldı; yayındaki set değişmedi.` };
  }
  return { ok: true, version: pub.version, notice: `Onaylandı, sürüm ${pub.version} yayınlandı.` };
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
  const valid = validateRuleSet(t.content, { portal: parsed.data.portal });
  if (!valid.ok) return { error: `Bu sürümün içeriği bugünkü doğrulamadan geçmiyor, geri dönülemez (${valid.reason}).` };

  const key = signingKey();
  if (!key) return { error: SIGNING_UNAVAILABLE };
  const r = await rollbackRuleSet(db as unknown as RpcDb, { portal: parsed.data.portal, toVersion: parsed.data.version, nowMs: now(), key });
  if (!r.ok) return { error: publishFailure(r, "Geri alma") };
  refresh();
  return { ok: true, version: r.version, notice: `Sürüm ${parsed.data.version} içeriği sürüm ${r.version} olarak yayınlandı.` };
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

  const key = signingKey();
  if (!key) return { error: SIGNING_UNAVAILABLE };
  // Damga (sürüm 1, şimdi, 14 gün) publishRuleSet'te basılır; tohumun 9999 son tarihi yayına taşınmaz.
  const r = await publishRuleSet(db as unknown as RpcDb, {
    portal: parsed.data,
    content: seedRuleSet(parsed.data),
    kind: "seed",
    parentId: null,
    changeSummary: { seed: true, count: 0 },
    nowMs: now(),
    key,
  });
  if (!r.ok) return { error: publishFailure(r, "Tohum yayını") };
  refresh();
  return { ok: true, version: r.version, notice: `Tohum sürüm ${r.version} olarak yayınlandı.` };
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
  const { data, error } = await db.rpc("pt_rules_admin_set_trust", {
    p_tenant_id: parsed.data.tenantId,
    p_eligible: parsed.data.eligible,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: dbError(error, "Uygunluk") };
  if (outcomeOf(data) !== "ok") return { error: outcomeText(outcomeOf(data), "Uygunluk") };
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
  let r: SuggestResult;
  try {
    r = await suggestPortalRules({ db: db as unknown as RpcDb, portal: parsed.data, actorId: staff.id });
  } catch (e) {
    console.error("runAiSuggest", e);
    return { error: "AI önerisi üretilemedi." };
  }
  if (!r.ok) {
    if (r.error === "schema_pending") return { error: SCHEMA_PENDING };
    if (r.error === "ai_unconfigured") return { error: "AI sağlayıcısı yapılandırılmamış (OpenAI anahtarı yok); öneri üretilemedi." };
    if (r.error === "rate_limited") return { error: "AI önerisi hız sınırına takıldı (portal başına 10 dakikada 1, günde en çok 20). Biraz sonra tekrar deneyin." };
    if (r.error === "forbidden") return { error: OUTCOME_TEXT.forbidden };
    if (r.error === "invalid_output") return { error: "AI yanıtı doğrulamadan geçmedi; öneri eklenmedi." };
    return { error: "AI önerisi üretilemedi." };
  }
  if (r.outcome === "no_input") {
    const raw = Number(((await getSettings(["portal_rules.ai_min_tenants"]).catch(() => ({}))) as Record<string, unknown>)["portal_rules.ai_min_tenants"]);
    const n = Number.isFinite(raw) && raw > 0 ? Math.max(2, raw) : 2;
    return { ok: false, error: `Yetersiz veri (en az ${n} ofiste görülen eşleşmemiş alan yok).` };
  }
  refresh();
  if (r.created === 0) return { ok: true, notice: "AI yeni öneri üretmedi (girdiler mevcut önerilerle aynı ya da uygun öneri yok)." };
  return { ok: true, notice: `${r.created} AI önerisi eklendi (doğrulanmamış).` };
}
