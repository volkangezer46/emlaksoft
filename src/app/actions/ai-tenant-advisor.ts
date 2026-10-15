"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { getOpenAiKey } from "@/lib/ai-advisor";
import { loadCustomerStates } from "@/lib/customer-state/load";
import { checkRateLimit } from "@/lib/rate-limit";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getOpenAiChatModel, openAiChat } from "@/lib/ai/openai-client";
import { createTask } from "@/app/actions/tasks";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import { buildAdvisorScope, gated, type AdvisorScope } from "@/lib/ai/advisor-scope";
import { DAY_MS, now, trDayStartMs } from "@/lib/clock";
import { trMonthContext } from "@/lib/team/scorecard";
import { faqContextForMessages } from "@/lib/ai/faq-context";
import { getHelpContent } from "@/lib/help-center/store";
import type { FaqItem } from "@/lib/help-faq";
import {
  fallbackAdvisorActions,
  fallbackTenantAdvisor,
  money,
  type AdvisorAction,
  type AdvisorHotCustomer,
  type HotLead,
  type TenantAdvisorContext,
  type TenantAdvisorMessage,
} from "@/lib/ai/tenant-advisor-fallback";
import { actionErrorMessage } from "@/lib/action-errors";

// ---------------------------------------------------------------------------
// Ofis (tenant) yapay zeka asistanı — admin danışman deseninin tenant uyarlaması.
// RLS'li normal client kullanır: kullanıcı yalnızca kendi ofisinin verisini görür.
// OpenAI anahtarı yoksa kural tabanlı yedek yanıtlar üretir (bkz. lib/ai-advisor).
// ---------------------------------------------------------------------------

export type { AdvisorAction, AdvisorHotCustomer, TenantAdvisorMessage } from "@/lib/ai/tenant-advisor-fallback";
export type TenantAdvisorResult = { reply: string; usedAI: boolean };
export type AskTenantAdvisorResult = TenantAdvisorResult & { sessionId: string };

// ---------------------------------------------------------------------------
// Onaylı eylem önerileri — AI asla doğrudan yazmaz: araç çağrısı SSE'de
// `data: {action:{type,params}}` olayına çevrilir, kullanıcı kartta butonla
// onaylar (onay action'ları bu dosyanın sonunda).
// ---------------------------------------------------------------------------


const MAX_MESSAGES = 12;
const MAX_LEN = 2000;
const OPENAI_MODEL = getOpenAiChatModel();
const OPENAI_TIMEOUT_MS = 45_000;
const OPENAI_MAX_RESPONSE_BYTES = 1024 * 1024;

const RATE_LIMIT_ERROR = "Çok fazla istek gönderildi. Lütfen bir dakika sonra tekrar deneyin.";

/**
 * Kullanıcı başına dakikada 10 mesaj. Kontrol burada (bağlam sorgularından
 * ÖNCE) yapılır: 'use server' export'ları route'u atlayıp doğrudan POST
 * edilebildiğinden hız sınırı route'a değil action'a aittir; ayrıca limit
 * aşımında 13 sorguluk bağlam derlemesinin maliyeti hiç ödenmez.
 */
async function advisorRateLimited(userId: string): Promise<boolean> {
  const { allowed } = await checkRateLimit(`ai-chat:${userId}`, {
    limit: 10,
    windowSec: 60,
    failurePolicy: "deny",
  });
  return !allowed;
}

async function advisorScopeFor(gate: { tenantId: string; userId: string; role: string }): Promise<AdvisorScope> {
  const perms = await getEffectivePermissions(gate.tenantId, gate.role, gate.userId);
  return buildAdvisorScope(perms, gate.role, gate.userId);
}


// ---------------------------------------------------------------------------
// Bağlam — ofisin canlı verileri (RLS zaten tenant'a sınırlar)
// ---------------------------------------------------------------------------


async function buildTenantContext(tenantId: string, scope: AdvisorScope): Promise<TenantAdvisorContext> {
  const supabase = await createClient();

  // B8: gün/ay sınırları Türkiye takvimine göre (sunucu UTC olabilir).
  const dayStartMs = trDayStartMs();
  const dayStartIso = new Date(dayStartMs).toISOString();
  const dayEndIso = new Date(dayStartMs + DAY_MS).toISOString();
  const monthStartIso = trMonthContext(now()).monthStartIso;
  // B3: ofis geneli kapsam dışındaki roller yalnız kendi atandıkları kayıtları görür.
  const mine = <Q,>(q: Q): Q =>
    scope.officeWide ? q : (q as unknown as { eq: (c: string, v: string) => Q }).eq("assigned_to", scope.userId);

  const [
    { count: customers },
    { count: properties },
    { count: activeDeals },
    { data: wonDeals },
    { count: newDemands },
    { count: openTasks },
    { count: tasksOverdue },
    { count: tasksDueToday },
    { count: todayAppointments },
    { data: commissionRows },
    { data: leadCustomers },
    { data: redProperties, count: overpricedCount },
    commissionAgg,
  ] = await Promise.all([
    gated(scope.customers, () =>
      mine(supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null)),
    ),
    gated(scope.properties, () =>
      mine(supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null)),
    ),
    gated(scope.deals, () =>
      mine(supabase.from("deals").select("id", { count: "exact", head: true }).not("stage", "in", "(won,lost)")),
    ),
    gated(scope.deals, () =>
      mine(
        supabase
          .from("deals")
          .select("deal_value")
          .eq("stage", "won")
          .gte("updated_at", monthStartIso)
          .limit(200),
      ),
    ),
    gated(scope.demands, () =>
      scope.officeWide
        ? supabase.from("customer_demands").select("id", { count: "exact", head: true }).eq("status", "new")
        : supabase
            .from("customer_demands")
            .select("id, customer:customers!customer_demands_customer_id_fkey!inner(assigned_to)", { count: "exact", head: true })
            .eq("status", "new")
            .eq("customer.assigned_to", scope.userId),
    ),
    gated(scope.tasks, () =>
      mine(supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open")),
    ),
    gated(scope.tasks, () =>
      mine(
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("status", "open")
          .lt("due_at", dayStartIso),
      ),
    ),
    gated(scope.tasks, () =>
      mine(
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("status", "open")
          .gte("due_at", dayStartIso)
          .lt("due_at", dayEndIso),
      ),
    ),
    gated(scope.appointments, () =>
      mine(
        supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .gte("scheduled_at", dayStartIso)
          .lt("scheduled_at", dayEndIso)
          .neq("status", "cancelled"),
      ),
    ),
    // B3: bekleyen komisyon toplamı yalnız earnings_all sahibine.
    gated(scope.commissionTotal, () =>
      supabase
        .from("commissions")
        .select("gross_amount, status")
        .not("status", "in", "(paid,collected)")
        .limit(500),
    ),
    // Sıcak lead hesabı — tek okuyucu: lib/customer-state (ad yalnız customers izniyle)
    gated(scope.customers, () =>
      mine(
        supabase
          .from("customers")
          .select("id, full_name, phone, email, source, blacklist, created_at, customer_types")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(200),
      ),
    ),
    gated(scope.properties, () =>
      mine(
        supabase
          .from("properties")
          .select("id, title, property_code, list_price", { count: "exact" })
          .is("deleted_at", null)
          .in("price_health", ["red", "Kırmızı"])
          .limit(5),
      ),
    ),
    // Ciro: ana ekran komisyon özetiyle aynı RPC (aylık tahsil edilen; kazanç gizliliği RPC içinde).
    scope.commissions
      ? supabase.rpc("tenant_commission_aggregates", { p_as_of: new Date(now()).toISOString() }).then(
          (r) => r,
          () => null,
        )
      : Promise.resolve(null),
  ]);

  // Sıcaklık: tek okuyucu (lib/customer-state) — ekranlarla aynı müşteri aynı sıcaklıkta.
  const leadRows = (leadCustomers ?? []) as {
    id: string; full_name: string; phone: string | null; email: string | null; source: string | null;
    blacklist: boolean | null; created_at: string; customer_types: string[] | null;
  }[];
  const states = await loadCustomerStates(supabase, tenantId, leadRows, { context: "AI danışman" });
  const hotLeads: HotLead[] = [];
  for (const c of leadRows) {
    const st = states.get(c.id);
    if (st && st.temperature === "sicak" && !c.blacklist) hotLeads.push({ id: c.id, name: c.full_name, score: st.scores.heat.score });
  }
  hotLeads.sort((a, b) => b.score - a.score);

  const pendingCommission = (commissionRows ?? []).reduce(
    (sum, r) => sum + (Number(r.gross_amount) || 0),
    0,
  );
  // Ciro = bu ay tahsil edilen komisyon; ana ekran komisyon özetiyle aynı kaynak (RPC kazanç gizliliğini kendisi uygular).
  const monthly = (commissionAgg?.data as { monthly?: { paid?: number | string | null }[] } | null)?.monthly ?? [];
  const collectedThisMonth = scope.commissions && !commissionAgg?.error ? Number(monthly[monthly.length - 1]?.paid ?? 0) || 0 : null;
  const wonValueThisMonth = (wonDeals ?? []).reduce(
    (sum, d) => sum + (Number(d.deal_value) || 0),
    0,
  );

  return {
    scope,
    customers: customers ?? 0,
    properties: properties ?? 0,
    activeDeals: activeDeals ?? 0,
    wonThisMonth: (wonDeals ?? []).length,
    wonValueThisMonth,
    collectedThisMonth,
    newDemands: newDemands ?? 0,
    openTasks: openTasks ?? 0,
    tasksOverdue: tasksOverdue ?? 0,
    tasksDueToday: tasksDueToday ?? 0,
    todayAppointments: todayAppointments ?? 0,
    pendingCommission,
    hotLeadCount: hotLeads.length,
    hotLeads: hotLeads.slice(0, 5),
    overpricedCount: overpricedCount ?? 0,
    overpriced: (redProperties ?? []).map((p) => ({
      id: p.id,
      label: p.title || p.property_code,
      price: p.list_price != null ? Number(p.list_price) : null,
    })),
  };
}

/** Kapsam dışı kümeler bağlam metninden tümüyle çıkarılır (model "0" diye yanlış yorumlamasın, veri sızmasın). */
function contextToText(c: TenantAdvisorContext): string {
  const s = c.scope;
  const lines: string[] = [];
  if (s.customers) {
    lines.push(
      `Toplam müşteri: ${c.customers} (liste: /app/musteriler)`,
      `Sıcak müşteri (öncelikli aranacaklar): ${c.hotLeadCount} (liste: /app/musteriler?sort=hot)`,
      ...c.hotLeads.map((l) => `- Sıcak müşteri: ${l.name} (sıcaklık ${l.score}/100, detay: /app/musteriler/${l.id})`),
    );
  }
  if (s.properties) {
    lines.push(
      `Toplam portföy: ${c.properties} (liste: /app/portfoyler)`,
      `Fiyatı piyasaya göre yüksek (riskli) portföy: ${c.overpricedCount} (liste: /app/portfoyler?saglik=riskli)`,
      ...c.overpriced.map(
        (p) =>
          `- Riskli fiyatlı portföy: ${p.label}${p.price != null ? ` (${money(p.price)})` : ""} (detay: /app/portfoyler/${p.id})`,
      ),
    );
  }
  if (s.deals) {
    lines.push(
      `Devam eden anlaşma: ${c.activeDeals} (liste: /app/anlasmalar)`,
      `Bu ay kazanılan anlaşma: ${c.wonThisMonth} (satış hacmi, ciro değildir: ${money(c.wonValueThisMonth)})`,
    );
  }
  if (c.collectedThisMonth !== null) {
    lines.push(`Bu ayın cirosu (tahsil edilen komisyon): ${money(c.collectedThisMonth)} (liste: /app/komisyon)`);
  }
  if (s.demands) lines.push(`Yeni (işlenmemiş) talep: ${c.newDemands} (liste: /app/talepler)`);
  if (s.tasks) {
    lines.push(
      `Açık görev: ${c.openTasks} (liste: /app/gorevler)`,
      `Gecikmiş görev: ${c.tasksOverdue} (liste: /app/gorevler?filter=overdue)`,
      `Bugün vadesi gelen görev: ${c.tasksDueToday} (liste: /app/gorevler?filter=today)`,
    );
  }
  if (s.appointments) lines.push(`Bugünkü randevu: ${c.todayAppointments} (liste: /app/randevular)`);
  if (s.commissionTotal) {
    lines.push(`Tahsilat bekleyen komisyon: ${money(c.pendingCommission)} (liste: /app/komisyon?durum=bekleyen)`);
  }
  return lines.length ? lines.join("\n") : "Bu kullanıcının erişebildiği veri kümesi yok.";
}

// ---------------------------------------------------------------------------
// LLM çağrısı (lib/ai-advisor'daki desenle aynı; admin'e bağımlılık yok)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Sen EmlakSoft'un ofis içi yapay zeka asistanısın. Kullanıcın bir emlak ofisi danışmanı/yöneticisi.
Görevin: kendisine ait canlı CRM verilerine bakarak Türkçe, net, uygulanabilir öneriler vermek. Kısa ve öz ol, madde işaretleri kullan.
İngilizce ürün kelimeleri (lead, task, deal, pipeline, dashboard) kullanma; yerine: sıcak müşteri, görev, anlaşma, satış hunisi, ana ekran.
Sayıları yalnızca verilen bağlamdan al; uydurma. Somut aksiyon öner (ör. "3 sıcak müşteriyi bugün ara").
Bağlamda /app/... ile başlayan bağlantılar var; önerilerinde ilgili sayfaya yönlendirmek için bu bağlantıları aynen kullan.
Cevapların profesyonel, samimi ve doğrudan olsun.`;

async function callOpenAI(
  apiKey: string,
  messages: TenantAdvisorMessage[],
  context: TenantAdvisorContext,
  audit: { tenantId: string; actorId: string },
  faq?: readonly FaqItem[],
): Promise<string> {
  // Ürün kullanımı SSS'si yardım merkezinden (kod + yayındaki DB makaleleri; AD12).
  const faqCtx = faqContextForMessages(messages, faq);
  const { content } = await openAiChat({
    apiKey,
    purpose: "tenant_advisor",
    audit,
    timeoutMs: OPENAI_TIMEOUT_MS,
    maxResponseBytes: OPENAI_MAX_RESPONSE_BYTES,
    body: {
      model: OPENAI_MODEL,
      temperature: 0.4,
      max_tokens: 700,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: `OFİSİN GÜNCEL VERİLERİ:
${contextToText(context)}` },
        // Ürün kullanımı sorusu ise resmî SSS'den ilgili kayıtlar (eşleşme yoksa hiçbir şey eklenmez).
        ...(faqCtx ? [{ role: "system" as const, content: faqCtx }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    },
  });
  if (!content) throw new Error("OpenAI boş yanıt döndü.");
  return content.trim();
}

// ---------------------------------------------------------------------------
// Kural tabanlı yedek yanıtlar — anahtar yoksa / hata olursa
// ---------------------------------------------------------------------------

/* detectTopics, fallbackTenantAdvisor, fallbackAdvisorActions: src/lib/ai/tenant-advisor-fallback.ts (saf, testli). */
// ---------------------------------------------------------------------------
// Sohbet — DB'ye kayıtlı (RLS'li client; kullanıcı yalnızca kendi oturumları)
// ---------------------------------------------------------------------------

function sanitizeMessages(messages: TenantAdvisorMessage[]): TenantAdvisorMessage[] {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_LEN) }));
}

/** Son kullanıcı mesajını + asistan yanıtını oturuma kaydeder (hata olursa sessizce geç). */
async function persistTurn(
  tenantId: string,
  userId: string,
  clean: TenantAdvisorMessage[],
  result: TenantAdvisorResult,
  sessionId?: string | null,
  actions?: AdvisorAction[] | null,
): Promise<string> {
  try {
    const supabase = await createClient();
    let sid = sessionId ?? null;

    if (!sid) {
      const firstUserMsg = clean.find((m) => m.role === "user")?.content ?? "Yeni sohbet";
      const title = firstUserMsg.slice(0, 60) + (firstUserMsg.length > 60 ? "…" : "");
      const { data: session } = await supabase
        .from("tenant_advisor_sessions")
        .insert({ tenant_id: tenantId, user_id: userId, title })
        .select("id")
        .single();
      sid = session?.id ?? null;
    }

    if (sid) {
      const lastUser = clean[clean.length - 1]!;
      await supabase.from("tenant_advisor_messages").insert([
        { session_id: sid, role: "user", content: lastUser.content, used_ai: false },
        {
          session_id: sid,
          role: "assistant",
          content: result.reply,
          used_ai: result.usedAI,
          // O turda üretilen eylem kartları — geçmiş oturum açılınca yeniden render edilir
          actions: actions && actions.length > 0 ? actions : null,
        },
      ]);
    }

    return sid ?? "";
  } catch (e) {
    console.error("askTenantAdvisor:db", e);
    return sessionId ?? "";
  }
}

export async function askTenantAdvisor(
  messages: TenantAdvisorMessage[],
  sessionId?: string | null,
): Promise<AskTenantAdvisorResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) {
    return { reply: gate.error, usedAI: false, sessionId: sessionId ?? "" };
  }

  const clean = sanitizeMessages(messages);

  if (clean.length === 0 || clean[clean.length - 1]!.role !== "user") {
    return {
      reply: "Bir soru yazın; ofisinizin canlı verileriyle yanıtlayayım.",
      usedAI: false,
      sessionId: sessionId ?? "",
    };
  }

  if (await advisorRateLimited(gate.userId)) {
    return { reply: RATE_LIMIT_ERROR, usedAI: false, sessionId: sessionId ?? "" };
  }

  const [context, { faq }] = await Promise.all([buildTenantContext(gate.tenantId, await advisorScopeFor(gate)), getHelpContent()]);
  const apiKey = await getOpenAiKey();

  let result: TenantAdvisorResult;
  if (apiKey) {
    try {
      result = { reply: await callOpenAI(apiKey, clean, context, { tenantId: gate.tenantId, actorId: gate.userId }, faq), usedAI: true };
    } catch (e) {
      console.error("askTenantAdvisor:openai", externalErrorMetadata(e));
      result = { reply: fallbackTenantAdvisor(clean, context, faq), usedAI: false };
    }
  } else {
    result = { reply: fallbackTenantAdvisor(clean, context, faq), usedAI: false };
  }

  // DB'ye kaydet (hata olursa sessizce geç — UI kırılmasın)
  const sid = await persistTurn(gate.tenantId, gate.userId, clean, result, sessionId);
  return { ...result, sessionId: sid };
}

// ---------------------------------------------------------------------------
// Streaming route desteği (/api/ai/tenant-chat) — bağlam toplama ve kaydetme
// mantığını KOPYALAMADAN dışa açar. "use server" dosyasından yalnızca async
// fonksiyon export edilebildiği için sync yardımcılar (contextToText,
// fallbackTenantAdvisor) async sarmalayıcılarla sunulur; davranış değişmez.
// Her iki fonksiyon da kendi yetki kontrolünü yapar.
// ---------------------------------------------------------------------------

export type TenantAdvisorTurnPrep =
  | { ok: false; error: string; rateLimited?: boolean }
  | {
      ok: true;
      tenantId: string;
      userId: string;
      clean: TenantAdvisorMessage[];
      systemPrompt: string;
      contextText: string;
      fallbackReply: string;
      /** Yedek kipte yanıtla birlikte gönderilecek eylem kartları. */
      fallbackActions: AdvisorAction[];
      /** list_hot_customers aracının sunucuda doldurulan gerçek listesi. */
      hotCustomers: AdvisorHotCustomer[];
    };

/** Yetki + mesaj temizliği + bağlam toplama — stream öncesi tek seferde hazırlar. */
export async function prepareTenantAdvisorTurn(
  messages: TenantAdvisorMessage[],
): Promise<TenantAdvisorTurnPrep> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { ok: false, error: gate.error };

  const clean = sanitizeMessages(messages);
  if (clean.length === 0 || clean[clean.length - 1]!.role !== "user") {
    return { ok: false, error: "Bir soru yazın; ofisinizin canlı verileriyle yanıtlayayım." };
  }

  if (await advisorRateLimited(gate.userId)) {
    return { ok: false, error: RATE_LIMIT_ERROR, rateLimited: true };
  }

  const [context, { faq }] = await Promise.all([buildTenantContext(gate.tenantId, await advisorScopeFor(gate)), getHelpContent()]);
  const faqCtx = faqContextForMessages(clean, faq);
  return {
    ok: true,
    tenantId: gate.tenantId,
    userId: gate.userId,
    clean,
    systemPrompt: SYSTEM_PROMPT,
    contextText: `OFİSİN GÜNCEL VERİLERİ:\n${contextToText(context)}${faqCtx ? `\n\n${faqCtx}` : ""}`,
    fallbackReply: fallbackTenantAdvisor(clean, context, faq),
    fallbackActions: fallbackAdvisorActions(clean, context),
    hotCustomers: context.hotLeads,
  };
}

/** Stream tamamlanınca sohbet turunu kaydeder; oturum ID döner ("" = kaydedilemedi). */
export async function saveTenantAdvisorTurn(
  messages: TenantAdvisorMessage[],
  reply: string,
  usedAI: boolean,
  sessionId?: string | null,
  actions?: AdvisorAction[] | null,
): Promise<string> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return sessionId ?? "";

  const clean = sanitizeMessages(messages);
  if (clean.length === 0 || clean[clean.length - 1]!.role !== "user") return sessionId ?? "";

  return persistTurn(gate.tenantId, gate.userId, clean, { reply, usedAI }, sessionId, actions);
}

// ---------------------------------------------------------------------------
// Oturum listesi / geçmiş / silme
// ---------------------------------------------------------------------------

export type TenantSessionSummary = {
  id: string;
  title: string | null;
  updated_at: string;
};

export async function listTenantAdvisorSessions(limit = 20): Promise<TenantSessionSummary[]> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("tenant_advisor_sessions")
    .select("id, title, updated_at")
    .eq("user_id", gate.userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as TenantSessionSummary[];
}

export type TenantPersistedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  used_ai: boolean;
  created_at: string;
  /** Mesajla birlikte kaydedilen eylem kartları (null = kart yok). */
  actions: AdvisorAction[] | null;
};

export async function loadTenantAdvisorSession(sessionId: string): Promise<TenantPersistedMessage[]> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  // RLS zaten kısıtlar; yine de oturum sahipliğini doğrula
  const { data: session } = await supabase
    .from("tenant_advisor_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", gate.userId)
    .maybeSingle();
  if (!session) return [];

  const { data } = await supabase
    .from("tenant_advisor_messages")
    .select("id, role, content, used_ai, created_at, actions")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  return (data ?? []) as TenantPersistedMessage[];
}

export async function deleteTenantAdvisorSession(sessionId: string): Promise<{ ok: boolean }> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { ok: false };

  const supabase = await createClient();
  await supabase
    .from("tenant_advisor_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", gate.userId);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sayfa üstü KPI özeti — /app/asistan başlık kartları için
// ---------------------------------------------------------------------------

export type TenantAdvisorSnapshot = {
  customers: number;
  properties: number;
  hotLeads: number;
  tasksOverdue: number;
};

export async function getTenantAdvisorSnapshot(): Promise<TenantAdvisorSnapshot | null> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return null;

  const c = await buildTenantContext(gate.tenantId, await advisorScopeFor(gate));
  return {
    customers: c.customers,
    properties: c.properties,
    hotLeads: c.hotLeadCount,
    tasksOverdue: c.tasksOverdue,
  };
}

// ---------------------------------------------------------------------------
// Eylem onayları — AI yalnızca önerir; yazma BURADA, kullanıcı butona basınca
// olur. Müşteri adı → id çözümü sunucuda, RLS'li client ile (tenant-scoped);
// yazmalar mevcut kapılı action'lara delege edilir (createTask / SmsDialog →
// sendCustomerSms), yeniden yazılmaz.
// ---------------------------------------------------------------------------

const TASK_TITLE_MAX = 120;
const CUSTOMER_NAME_MAX = 100;

/**
 * AI'nin döndürdüğü müşteri adını tenant içinde id'ye çözer (önce tam, sonra
 * kapsayan eşleşme). RLS zaten tenant'a sınırlar; silinmişler hariç.
 */
async function findCustomerByName(name: string): Promise<{ id: string; name: string } | null> {
  // % ve _ ilike joker karakterleri — ad içinde anlamsız, ayıkla
  const q = name.trim().slice(0, CUSTOMER_NAME_MAX).replace(/[%_]/g, "");
  if (!q) return null;

  const supabase = await createClient();
  const { data: exact } = await supabase
    .from("customers")
    .select("id, full_name")
    .is("deleted_at", null)
    .ilike("full_name", q)
    .limit(1);
  if (exact?.[0]) return { id: exact[0].id, name: exact[0].full_name };

  const { data: partial } = await supabase
    .from("customers")
    .select("id, full_name")
    .is("deleted_at", null)
    .ilike("full_name", `%${q}%`)
    .limit(1);
  return partial?.[0] ? { id: partial[0].id, name: partial[0].full_name } : null;
}

export type ConfirmSuggestedTaskResult =
  | { ok: true; taskId: string; customerMatched: boolean }
  | { ok: false; error: string };

/**
 * "Görevi oluştur" onayı — suggest_task kartından çağrılır. Parametreler
 * sunucuda yeniden doğrulanır; kayıt mevcut kapılı createTask ile yapılır
 * (tasks/create izni orada da denetlenir). Müşteri adı çözülemezse görev
 * müşterisiz oluşturulur.
 */
export async function confirmSuggestedTask(input: {
  title: string;
  dueInDays: number;
  customerName?: string;
}): Promise<ConfirmSuggestedTaskResult> {
  const gate = await requirePermission("tasks", "create");
  if (!gate.ok) return { ok: false, error: gate.error };

  const title = String(input?.title ?? "").trim().slice(0, TASK_TITLE_MAX);
  if (!title) return { ok: false, error: "Görev başlığı boş olamaz." };

  const days = Math.round(Number(input?.dueInDays));
  if (!Number.isFinite(days) || days < 1 || days > 90) {
    return { ok: false, error: "Termin 1-90 gün aralığında olmalı." };
  }

  const customerName =
    typeof input?.customerName === "string" ? input.customerName.trim() : "";
  const customer = customerName ? await findCustomerByName(customerName) : null;

  const due = new Date();
  due.setDate(due.getDate() + days);
  due.setHours(18, 0, 0, 0); // gün sonu terminli

  const fd = new FormData();
  fd.set("title", title);
  fd.set("kind", "followup");
  fd.set("priority", "normal");
  fd.set("due_at", due.toISOString());
  if (customer) fd.set("customer_id", customer.id);

  const res = await createTask({}, fd);
  if (res.error || !res.id) {
    return { ok: false, error: res.error ?? actionErrorMessage(res.error, "Görev oluşturulamadı. Lütfen tekrar deneyin.") };
  }
  return { ok: true, taskId: res.id, customerMatched: Boolean(customer) };
}

export type ResolveSmsCustomerResult =
  | { ok: true; customerId: string; customerName: string; consentGranted: boolean }
  | { ok: false; error: string };

/**
 * draft_sms kartı için müşteri adı → id + İYS SMS onayı çözümü. Gönderim
 * SmsDialog → sendCustomerSms üzerinden yürür (İYS kapısı orada da var);
 * burada yalnızca dialogu açacak bilgiler hazırlanır.
 */
export async function resolveSmsCustomer(customerName: string): Promise<ResolveSmsCustomerResult> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return { ok: false, error: gate.error };

  const customer = await findCustomerByName(String(customerName ?? ""));
  if (!customer) {
    return {
      ok: false,
      error: "Müşteri bulunamadı. Adı kontrol edin veya müşteri kartından SMS gönderin.",
    };
  }

  const supabase = await createClient();
  const { data: consents } = await supabase
    .from("iys_consents")
    .select("status")
    .eq("customer_id", customer.id)
    .eq("channel", "sms")
    .limit(1);

  return {
    ok: true,
    customerId: customer.id,
    customerName: customer.name,
    consentGranted: (consents ?? []).some((r) => r.status === "granted"),
  };
}
