import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { now } from "@/lib/clock";
import { getSetting } from "@/lib/settings/read";
import { isFeatureEnabled } from "@/lib/feature-flags/server";
import { loadFlagRules } from "@/lib/feature-flags/rules";
import { isSchemaMissing } from "@/lib/platform-announcements/queue";
import { FEEDBACK_SETTING_KEYS, NPS_INTERVAL_DEFAULT_DAYS } from "@/lib/settings/registry/feedback";
import { ActionUserError } from "@/lib/action-errors";
import {
  canVoteOn,
  npsEligible,
  npsPending,
  PUBLIC_REQUEST_STATUSES,
  type NpsShownRow,
  requestVisibleTo,
  type RequestStatus,
} from "./model";

/**
 * ÜRÜN GERİ BİLDİRİMİ deposu (DG8; yalnız sunucu). Tablolar RLS + FORCE ve politikasızdır: tüm okuma/yazma
 * service_role ile BURADAN yapılır; kapılar çağıran eylemdedir (ofis: requirePermission("support", ...), admin:
 * requirePlatformModule). Ofis tarafı her zaman ÇAĞIRANIN ofis kimliğiyle süzer (başka ofisin "yeni" önerisi ve
 * oyu görünmez). Tablolar yokken (migration uygulanmadı) `ready: false` döner; ekran "kurulum bekliyor" der.
 */

export type BoardItem = {
  id: string;
  title: string;
  body: string | null;
  status: RequestStatus;
  voteCount: number;
  adminNote: string | null;
  createdAt: string;
  mine: boolean;
  voted: boolean;
  canVote: boolean;
};

const BOARD_CAP = 500;

/** Ofisin bayrak hedeflemesi için planı (yoksa null). */
export async function tenantPlanOf(tenantId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("tenants").select("plan").eq("id", tenantId).maybeSingle();
  return ((data as { plan?: string | null } | null)?.plan ?? null) || null;
}

/**
 * Pano bu ofiste açık mı (genel anahtar + hedefleme). Migration (20261014008000) uygulanmadıysa kapalı sayılır:
 * ofise "hazırlanıyor" diyen çıkmaz sekme gösterilmez.
 */
export async function boardEnabledFor(tenantId: string, plan?: string | null): Promise<boolean> {
  const [p, { schemaReady }] = await Promise.all([plan === undefined ? tenantPlanOf(tenantId) : Promise.resolve(plan), loadFlagRules()]);
  if (!schemaReady) return false;
  return isFeatureEnabled("feature_board", { tenantId, plan: p });
}

/** Ofisin gördüğü pano: herkese açık durumdaki öneriler + kendi önerileri (oy sayısına göre). */
export async function loadBoard(tenantId: string): Promise<{ ready: boolean; items: BoardItem[]; truncated: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("product_feature_requests")
    .select("id, tenant_id, title, body, status, vote_count, admin_note, created_at")
    .or(`status.in.(${PUBLIC_REQUEST_STATUSES.join(",")}),tenant_id.eq.${tenantId}`)
    .order("vote_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(BOARD_CAP);
  if (error) {
    if (isSchemaMissing(error)) return { ready: false, items: [], truncated: false };
    throw new Error("Öneri panosu okunamadı.");
  }
  const rows = (data ?? []) as { id: string; tenant_id: string; title: string; body: string | null; status: RequestStatus; vote_count: number; admin_note: string | null; created_at: string }[];
  const ids = rows.map((r) => r.id);
  const voted = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: v } = await admin.from("product_feature_request_votes").select("request_id").eq("tenant_id", tenantId).in("request_id", ids.slice(i, i + 200));
    for (const r of (v ?? []) as { request_id: string }[]) voted.add(r.request_id);
  }
  return {
    ready: true,
    truncated: rows.length >= BOARD_CAP,
    items: rows
      .filter((r) => requestVisibleTo(r, tenantId))
      .map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        status: r.status,
        voteCount: r.vote_count,
        adminNote: r.admin_note,
        createdAt: r.created_at,
        mine: r.tenant_id === tenantId,
        voted: voted.has(r.id),
        canVote: canVoteOn(r, tenantId),
      })),
  };
}

/** Yeni öneri: "İnceleniyor" durumunda yalnız öneren ofise görünür; öneren ofis otomatik oy verir. */
export async function createFeatureRequest(input: { tenantId: string; userId: string; title: string; body: string | null }): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("product_feature_requests")
    .insert({ tenant_id: input.tenantId, created_by: input.userId, title: input.title, body: input.body })
    .select("id")
    .single();
  if (error || !data) {
    if (isSchemaMissing(error)) throw new ActionUserError("Öneri panosu henüz kurulmadı (veritabanı güncellemesi bekleniyor).");
    throw new Error("Öneri kaydedilemedi.");
  }
  // Otomatik oy yazılamazsa öneri kaydı geri alınmaz (ofis sonradan oy verebilir) ama hata görünür kalsın.
  const vote = await admin
    .from("product_feature_request_votes")
    .upsert({ request_id: data.id, tenant_id: input.tenantId, user_id: input.userId }, { onConflict: "request_id,tenant_id", ignoreDuplicates: true });
  if (vote.error) console.error("[product-feedback] öneren ofisin otomatik oyu yazılamadı", { requestId: data.id, error: vote.error.message });
  return data.id as string;
}

/**
 * Oy ver / geri al. OFİS BAŞINA TEK OY: anahtar (request_id, tenant_id); ikinci oy upsert ile yok sayılır, aynı
 * ofisten başka kullanıcı da ikinci oy yazamaz (DB birincil anahtarı). Görünmeyen/oylanamayan öneri reddedilir.
 */
export async function setFeatureRequestVote(input: { tenantId: string; userId: string; requestId: string; on: boolean }): Promise<number> {
  const admin = createAdminClient();
  const { data: row, error } = await admin.from("product_feature_requests").select("id, tenant_id, status").eq("id", input.requestId).maybeSingle();
  if (error) {
    if (isSchemaMissing(error)) throw new ActionUserError("Öneri panosu henüz kurulmadı (veritabanı güncellemesi bekleniyor).");
    throw new Error("Öneri okunamadı.");
  }
  const r = row as { id: string; tenant_id: string; status: string } | null;
  if (!r || !requestVisibleTo(r, input.tenantId)) throw new ActionUserError("Öneri bulunamadı.");
  if (!canVoteOn(r, input.tenantId)) throw new ActionUserError("Bu öneri artık oylanmıyor.");
  const res = input.on
    ? await admin
        .from("product_feature_request_votes")
        .upsert({ request_id: r.id, tenant_id: input.tenantId, user_id: input.userId }, { onConflict: "request_id,tenant_id", ignoreDuplicates: true })
    : await admin.from("product_feature_request_votes").delete().eq("request_id", r.id).eq("tenant_id", input.tenantId);
  if (res.error) throw new Error("Oy kaydedilemedi.");
  const { data: after } = await admin.from("product_feature_requests").select("vote_count").eq("id", r.id).maybeSingle();
  return Number((after as { vote_count?: number } | null)?.vote_count ?? 0);
}

// ---------------------------------------------------------------------------
// NPS (ofis kabuğu)
// ---------------------------------------------------------------------------

export type NpsPrompt = { surveyId: string; question: string };

async function npsIntervalDays(): Promise<number> {
  try {
    const v = await getSetting<number>(FEEDBACK_SETTING_KEYS.npsIntervalDays);
    return Number.isInteger(v) && v > 0 ? v : NPS_INTERVAL_DEFAULT_DAYS;
  } catch {
    return NPS_INTERVAL_DEFAULT_DAYS;
  }
}

type SurveyPick = { id: string; question: string; owners_only: boolean };

/** Ofise ve role göre şu an yayındaki anketler (en yeni önce). Hedef ofis listesi PostgREST süzgeciyle uygulanır. */
async function liveSurveysFor(tenantId: string, role: string): Promise<SurveyPick[]> {
  const admin = createAdminClient();
  const nowIso = new Date(now()).toISOString();
  const { data, error } = await admin
    .from("platform_nps_surveys")
    .select("id, question, owners_only")
    .eq("is_active", true)
    .lte("starts_at", nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .or(`tenant_ids.is.null,tenant_ids.cs.{${tenantId}}`)
    .order("starts_at", { ascending: false })
    .limit(20);
  if (error) return [];
  return ((data ?? []) as SurveyPick[]).filter((s) => !s.owners_only || role === "owner");
}

/**
 * Kabuk için: bu kullanıcıya şimdi NPS sorulmalı mı? Bayrak (hedefleme dahil) kapalıysa, sıklık sınırı dolmadıysa
 * ya da gösterilmemiş yayında anket yoksa null. Hiçbir hata kabuğu bozmaz (null).
 */
export async function loadNpsPrompt(input: { tenantId: string; userId: string; role: string; plan: string | null }): Promise<NpsPrompt | null> {
  try {
    const admin = createAdminClient();
    const [enabled, interval, surveys, last] = await Promise.all([
      isFeatureEnabled("nps_survey", { tenantId: input.tenantId, plan: input.plan }),
      npsIntervalDays(),
      liveSurveysFor(input.tenantId, input.role),
      admin
        .from("platform_nps_responses")
        .select("survey_id, shown_at, score, dismissed_at")
        .eq("user_id", input.userId)
        .order("shown_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (!enabled || surveys.length === 0 || last.error) return null;
    const lastRow = (last.data as NpsShownRow | null) ?? null;
    // Yarım kalan (gösterilmiş, yanıtsız) anket: kabuk tazelense de aynı anket açık kalır; yeni gösterim yazılmaz.
    if (lastRow && npsPending(lastRow, now())) {
      const same = surveys.find((s) => s.id === lastRow.survey_id);
      return same ? { surveyId: same.id, question: same.question } : null;
    }
    if (!npsEligible(lastRow?.shown_at ?? null, now(), interval)) return null;
    const { data: seen, error } = await admin
      .from("platform_nps_responses")
      .select("survey_id")
      .eq("user_id", input.userId)
      .in("survey_id", surveys.map((s) => s.id));
    if (error) return null;
    const seenIds = new Set(((seen ?? []) as { survey_id: string }[]).map((r) => r.survey_id));
    const pick = surveys.find((s) => !seenIds.has(s.id));
    return pick ? { surveyId: pick.id, question: pick.question } : null;
  } catch {
    return null;
  }
}

/**
 * Gösterim kaydı (istemci anketi ekrana getirdiğinde). Anket bu ofise/role hâlâ hedefli olmalı; sıklık sınırı DB
 * işleminde kullanıcı kilidiyle yeniden uygulanır. Sınır içindeyse null (istemci anketi gizler).
 */
export async function markNpsShown(input: { surveyId: string; tenantId: string; userId: string; role: string; plan: string | null }): Promise<string | null> {
  const [enabled, surveys, interval] = await Promise.all([
    isFeatureEnabled("nps_survey", { tenantId: input.tenantId, plan: input.plan }),
    liveSurveysFor(input.tenantId, input.role),
    npsIntervalDays(),
  ]);
  if (!enabled || !surveys.some((s) => s.id === input.surveyId)) return null;
  const admin = createAdminClient();
  // Aynı anketin yarım kalan gösterimi (yenileme/yeni sekme): mevcut satır döner, sıklık sınırına yeni gösterim yazılmaz.
  const { data: existing } = await admin
    .from("platform_nps_responses")
    .select("id, survey_id, shown_at, score, dismissed_at")
    .eq("user_id", input.userId)
    .eq("survey_id", input.surveyId)
    .maybeSingle();
  if (existing) return npsPending(existing as NpsShownRow, now()) ? ((existing as { id: string }).id ?? null) : null;
  const { data, error } = await admin.rpc("platform_nps_mark_shown", {
    p_survey: input.surveyId,
    p_tenant: input.tenantId,
    p_user: input.userId,
    p_interval_days: interval,
  });
  if (error) return null;
  return typeof data === "string" ? data : null;
}

/** Yanıt: yalnız kullanıcının kendi, henüz yanıtlanmamış gösterim satırına yazılır. */
export async function answerNps(input: { responseId: string; userId: string; score: number; comment: string | null }): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_nps_responses")
    .update({ score: input.score, comment: input.comment, responded_at: new Date(now()).toISOString(), dismissed_at: null })
    .eq("id", input.responseId)
    .eq("user_id", input.userId)
    .is("score", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Yanıt kaydedilemedi.");
  return Boolean(data);
}

export async function dismissNps(input: { responseId: string; userId: string }): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("platform_nps_responses")
    .update({ dismissed_at: new Date(now()).toISOString() })
    .eq("id", input.responseId)
    .eq("user_id", input.userId)
    .is("score", null);
}

// ---------------------------------------------------------------------------
// Admin okumaları
// ---------------------------------------------------------------------------

export type AdminRequestRow = {
  id: string;
  title: string;
  body: string | null;
  status: RequestStatus;
  voteCount: number;
  adminNote: string | null;
  createdAt: string;
  tenantId: string;
  tenantName: string | null;
};

/** Admin pano listesi: durum süzgeci + sayfalı (oy sayısına göre). */
export async function listRequestsForAdmin(input: { status: RequestStatus | null; from: number; to: number }): Promise<{ ready: boolean; rows: AdminRequestRow[]; total: number }> {
  const admin = createAdminClient();
  let q = admin
    .from("product_feature_requests")
    .select("id, title, body, status, vote_count, admin_note, created_at, tenant_id, tenant:tenants(name)", { count: "exact" });
  if (input.status) q = q.eq("status", input.status);
  const { data, error, count } = await q.order("vote_count", { ascending: false }).order("created_at", { ascending: false }).range(input.from, input.to);
  if (error) {
    if (isSchemaMissing(error)) return { ready: false, rows: [], total: 0 };
    throw new Error("Öneriler okunamadı.");
  }
  type Row = { id: string; title: string; body: string | null; status: RequestStatus; vote_count: number; admin_note: string | null; created_at: string; tenant_id: string; tenant: { name?: string } | { name?: string }[] | null };
  return {
    ready: true,
    total: count ?? 0,
    rows: ((data ?? []) as unknown as Row[]).map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      status: r.status,
      voteCount: r.vote_count,
      adminNote: r.admin_note,
      createdAt: r.created_at,
      tenantId: r.tenant_id,
      tenantName: (Array.isArray(r.tenant) ? r.tenant[0]?.name : r.tenant?.name) ?? null,
    })),
  };
}

/** Durum başına öneri sayısı (süzgeç çipleri için; her sayı kendi süzgecine götürür). */
export async function countRequestsByStatus(): Promise<Record<string, number>> {
  const admin = createAdminClient();
  const res = await readAllPaged<{ status: string }>((from, to) => admin.from("product_feature_requests").select("status").order("id").range(from, to));
  const out: Record<string, number> = {};
  for (const r of res.rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

export type AdminSurveyRow = {
  id: string;
  question: string;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  ownersOnly: boolean;
  tenantCount: number | null;
  segment: unknown;
  shown: number;
  scores: number[];
};

/** Admin NPS listesi: son 30 anket + gösterim/yanıt sayıları (yanıtlar sayfalı okunur). */
export async function listSurveysForAdmin(): Promise<{ ready: boolean; rows: AdminSurveyRow[]; truncated: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_nps_surveys")
    .select("id, question, starts_at, ends_at, is_active, owners_only, tenant_ids, segment_json")
    .order("starts_at", { ascending: false })
    .limit(30);
  if (error) {
    if (isSchemaMissing(error)) return { ready: false, rows: [], truncated: false };
    throw new Error("Anketler okunamadı.");
  }
  type Row = { id: string; question: string; starts_at: string; ends_at: string | null; is_active: boolean; owners_only: boolean; tenant_ids: string[] | null; segment_json: unknown };
  const surveys = (data ?? []) as Row[];
  const ids = surveys.map((s) => s.id);
  const res = ids.length
    ? await readAllPaged<{ survey_id: string; score: number | null }>((from, to) =>
        admin.from("platform_nps_responses").select("survey_id, score").in("survey_id", ids).order("id").range(from, to),
      )
    : { rows: [], error: null, truncated: false };
  const shown = new Map<string, number>();
  const scores = new Map<string, number[]>();
  for (const r of res.rows) {
    shown.set(r.survey_id, (shown.get(r.survey_id) ?? 0) + 1);
    if (r.score !== null) scores.set(r.survey_id, [...(scores.get(r.survey_id) ?? []), r.score]);
  }
  return {
    ready: true,
    truncated: res.truncated,
    rows: surveys.map((s) => ({
      id: s.id,
      question: s.question,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      isActive: s.is_active,
      ownersOnly: s.owners_only,
      tenantCount: s.tenant_ids ? s.tenant_ids.length : null,
      segment: s.segment_json,
      shown: shown.get(s.id) ?? 0,
      scores: scores.get(s.id) ?? [],
    })),
  };
}

export type SurveyComment = { id: string; score: number; comment: string; respondedAt: string; tenantId: string; tenantName: string | null };

/** Seçili anketin yorumlu yanıtları (en yeni önce; sayfalı). Puan süzgeci: eleştiren/pasif/destekçi. */
export async function listSurveyComments(input: { surveyId: string; band: "detractor" | "passive" | "promoter" | null; from: number; to: number }): Promise<{ rows: SurveyComment[]; total: number }> {
  const admin = createAdminClient();
  let q = admin
    .from("platform_nps_responses")
    .select("id, score, comment, responded_at, tenant_id, tenant:tenants(name)", { count: "exact" })
    .eq("survey_id", input.surveyId)
    .not("comment", "is", null);
  if (input.band === "detractor") q = q.lte("score", 6);
  else if (input.band === "passive") q = q.gte("score", 7).lte("score", 8);
  else if (input.band === "promoter") q = q.gte("score", 9);
  const { data, error, count } = await q.order("responded_at", { ascending: false }).range(input.from, input.to);
  if (error) return { rows: [], total: 0 };
  type Row = { id: string; score: number; comment: string; responded_at: string; tenant_id: string; tenant: { name?: string } | { name?: string }[] | null };
  return {
    total: count ?? 0,
    rows: ((data ?? []) as unknown as Row[]).map((r) => ({
      id: r.id,
      score: r.score,
      comment: r.comment,
      respondedAt: r.responded_at,
      tenantId: r.tenant_id,
      tenantName: (Array.isArray(r.tenant) ? r.tenant[0]?.name : r.tenant?.name) ?? null,
    })),
  };
}
