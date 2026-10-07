"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { notifyTenant } from "@/lib/notify";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { isFeatureEnabledIn } from "@/lib/modules/logic";
import { loadTenantModuleState } from "@/lib/modules/state";
import { validateAnswers } from "@/lib/surveys/logic";
import { isSurveyTaskLinkExpired } from "@/lib/surveys/task-expiry";
import { now } from "@/lib/clock";
import { completeSurveyTask, loadSurveySettings, loadTemplateQuestions } from "@/lib/surveys/server";
import { actionErrorMessage } from "@/lib/action-errors";

export type PublicSurveyResult = {
  ok?: boolean;
  error?: string;
  /** Anket daha önce cevaplandıysa true — "Yanıtınız alınmış" ekranı gösterilir. */
  alreadyAnswered?: boolean;
  /** Destekleyen (9-10) cevapta müşteriye özel tavsiye sayfası (teşekkür ekranında "Bizi tavsiye edin"). */
  referralUrl?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Memnuniyet anketi cevabı (/anket/[token] public sayfası).
 *
 * Auth YOK — public_token yeterli (registerOpenHouseVisitorByToken deseni).
 * RLS anon'a açılmadığı için service role ile yazılır. Tek cevap kuralı:
 * status='answered' olan anket bir daha güncellenmez (update'e eq filtresi).
 *
 * DÜŞÜK PUAN (0-6): danışmana ve (varsa, danışmandan farklıysa) ofis
 * sahibine ANINDA bildirim — telafi araması fırsat penceresi dardır.
 */
export async function submitSurveyByToken(fd: FormData): Promise<PublicSurveyResult> {
  const token = String(fd.get("token") ?? "").trim();
  const scoreRaw = String(fd.get("score") ?? "").trim();
  const comment = String(fd.get("comment") ?? "").trim().slice(0, 2000);
  // Honeypot — botlar gizli alanı doldurur; sessizce "başarılı" davran (lead formu deseni).
  if (String(fd.get("website") ?? "").trim()) return { ok: true };

  if (!UUID_RE.test(token)) return { error: "Geçersiz bağlantı." };
  const score = Number(scoreRaw);
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    return { error: "Lütfen 0-10 arası bir puan seçin." };
  }

  // Token tahmini / spam koruması — IP başına dakikada 10 deneme.
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`anket:${ip}`, {
    limit: 10,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: survey } = await admin
    .from("surveys")
    .select("id, tenant_id, customer_id, agent_id, status")
    .eq("public_token", token)
    .maybeSingle();

  if (!survey) return { error: "Bağlantı geçersiz veya anket bulunamadı." };
  const { data: tenant } = await admin
    .from("tenants")
    .select("status")
    .eq("id", survey.tenant_id)
    .maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status)) {
    return { error: "Bağlantı geçersiz veya anket bulunamadı." };
  }

  const [{ data: customer }, { data: agent }] = await Promise.all([
    admin
      .from("customers")
      .select("full_name")
      .eq("id", survey.customer_id)
      .eq("tenant_id", survey.tenant_id)
      .is("deleted_at", null)
      .maybeSingle(),
    survey.agent_id
      ? admin
          .from("profiles")
          .select("id")
          .eq("id", survey.agent_id)
          .eq("tenant_id", survey.tenant_id)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!customer || (survey.agent_id && !agent)) {
    return { error: "Bağlantı geçersiz veya anket bulunamadı." };
  }
  if (survey.status === "answered") return { ok: true, alreadyAnswered: true };

  // Yarışta ikinci yazımı da engelle: yalnız hâlâ 'pending' olan satır güncellenir.
  const { data: updated, error } = await admin
    .from("surveys")
    .update({
      score,
      comment: comment || null,
      status: "answered",
      answered_at: new Date().toISOString(),
    })
    .eq("id", survey.id)
    .eq("tenant_id", survey.tenant_id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("submitSurveyByToken", error);
    return { error: actionErrorMessage(error, "Yanıt kaydedilemedi. Lütfen tekrar deneyin.") };
  }
  if (!updated) return { ok: true, alreadyAnswered: true };

  // Düşük puan alarmı — bildirim hatası teşekkür ekranını düşürmesin.
  if (score <= 6) {
    try {
      const customerName = customer.full_name ?? "Müşteri";
      const agentId = agent?.id ?? null;
      const targets = new Set<string>();
      if (agentId) targets.add(agentId);
      // Ofis sahibi de görsün (danışmanın kendisi değilse) — telafi süreci yönetim işi.
      const { data: owner } = await admin
        .from("profiles")
        .select("id")
        .eq("tenant_id", String(survey.tenant_id))
        .eq("role", "owner")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (owner?.id) targets.add(String(owner.id));

      await Promise.all(
        [...targets].map((userId) =>
          notifyTenant({
            tenantId: String(survey.tenant_id),
            userId,
            title: `⚠ Düşük memnuniyet: ${customerName} ${score} verdi`,
            body: "Deneyimi telafi etmek için müşteriyi en kısa sürede arayın.",
            href: "/app/raporlar/memnuniyet",
            kind: "warning",
          }),
        ),
      );
    } catch (e) {
      console.error("survey low score notify", e);
    }
  }

  return { ok: true };
}

/**
 * Anketör görevi için bağlı link cevabı (/anket/[token], görev token'ı). Müşteri isterse telefona gerek kalmadan
 * aynı şablonu kendisi doldurur. Auth YOK — token yeterli; tek cevap kuralı: kapanmış görev bir daha yazılmaz
 * ("ulaşılamadı" görevi müşteri cevaplayabilir). Ofis "Anketler" modülünü kapattıysa cevap alınmaz.
 * `answers`: soru kimliği -> ham cevap (sunucuda şablona göre doğrulanır).
 */
export async function submitSurveyTaskByToken(fd: FormData): Promise<PublicSurveyResult> {
  const token = String(fd.get("token") ?? "").trim();
  if (String(fd.get("website") ?? "").trim()) return { ok: true };
  if (!UUID_RE.test(token)) return { error: "Geçersiz bağlantı." };

  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(String(fd.get("answers") ?? "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    return { error: actionErrorMessage(null, "Cevaplar okunamadı.") };
  }

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`anket:${ip}`, { limit: 10, windowSec: 60, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: task } = await admin
    .from("survey_tasks")
    .select("id, tenant_id, event_type, audience, customer_id, property_id, deal_id, agent_id, contact_name, attempts, status, template_id, due_at")
    .eq("public_token", token)
    .maybeSingle();
  const invalid = { error: "Bağlantı geçersiz veya anket bulunamadı." };
  if (!task || !task.template_id) return invalid;

  const tenantId = String(task.tenant_id);
  const { data: tenant } = await admin.from("tenants").select("status").eq("id", tenantId).maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status)) return invalid;
  const moduleState = await loadTenantModuleState(admin, tenantId);
  if (!isFeatureEnabledIn(moduleState, "surveys")) return invalid;
  if (task.status === "completed") return { ok: true, alreadyAnswered: true };
  if (task.status !== "pending" && task.status !== "unreachable") return invalid;
  // Görev token'ı süresiz değildir: due_at + SURVEY_TASK_LINK_VALID_DAYS gün sonra bağlantı kapanır.
  if (isSurveyTaskLinkExpired(task.due_at as string | null, now())) return invalid;
  // Örnek (is_sample) ilana bağlı görev public yüzde cevap almaz (anket sayfasıyla aynı kural).
  if (task.property_id) {
    const { data: p } = await admin
      .from("properties")
      .select("id")
      .eq("id", task.property_id)
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .maybeSingle();
    if (!p) return invalid;
  }

  const questions = await loadTemplateQuestions(admin, tenantId, String(task.template_id));
  const check = validateAnswers(questions, raw);
  if (!check.ok) return { error: check.error };

  let customerName = (task.contact_name as string | null) ?? "";
  if (task.customer_id) {
    const { data: c } = await admin
      .from("customers")
      .select("full_name, is_sample")
      .eq("id", task.customer_id)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!c || c.is_sample) return invalid;
    if (c.full_name) customerName = String(c.full_name);
  }
  const settings = await loadSurveySettings(admin, tenantId);
  try {
    const result = await completeSurveyTask(
      admin,
      {
        id: String(task.id),
        tenant_id: tenantId,
        event_type: String(task.event_type),
        audience: String(task.audience),
        customer_id: (task.customer_id as string | null) ?? null,
        property_id: (task.property_id as string | null) ?? null,
        deal_id: (task.deal_id as string | null) ?? null,
        agent_id: (task.agent_id as string | null) ?? null,
        contact_name: (task.contact_name as string | null) ?? null,
        attempts: Number(task.attempts) || 0,
      },
      { answers: check.answers, score: check.score, comment: check.comment, via: "link", userId: null, settings, customerName },
    );
    if (!result.done) return { ok: true, alreadyAnswered: true };
    // Destekleyen (9-10): teşekkür ekranında müşteriye özel tavsiye bağlantısı (ofis ayarı + modül açıksa).
    return result.referralUrl ? { ok: true, referralUrl: result.referralUrl } : { ok: true };
  } catch {
    return { error: actionErrorMessage(null, "Yanıt kaydedilemedi. Lütfen tekrar deneyin.") };
  }
}
