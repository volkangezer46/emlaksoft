"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { getOpenAiKey } from "@/lib/ai-advisor";
import { computeLeadScore } from "@/lib/lead-score";
import { checkRateLimit } from "@/lib/rate-limit";
import { createTask } from "@/app/actions/tasks";

// ---------------------------------------------------------------------------
// Ofis (tenant) yapay zeka asistanı — admin danışman deseninin tenant uyarlaması.
// RLS'li normal client kullanır: kullanıcı yalnızca kendi ofisinin verisini görür.
// OpenAI anahtarı yoksa kural tabanlı yedek yanıtlar üretir (bkz. lib/ai-advisor).
// ---------------------------------------------------------------------------

export type TenantAdvisorMessage = { role: "user" | "assistant"; content: string };
export type TenantAdvisorResult = { reply: string; usedAI: boolean };
export type AskTenantAdvisorResult = TenantAdvisorResult & { sessionId: string };

// ---------------------------------------------------------------------------
// Onaylı eylem önerileri — AI asla doğrudan yazmaz: araç çağrısı SSE'de
// `data: {action:{type,params}}` olayına çevrilir, kullanıcı kartta butonla
// onaylar (onay action'ları bu dosyanın sonunda).
// ---------------------------------------------------------------------------

export type AdvisorHotCustomer = { id: string; name: string; score: number };

export type AdvisorAction =
  | { type: "suggest_task"; params: { title: string; due_in_days: number; customer_name?: string } }
  | { type: "draft_sms"; params: { customer_name: string; message: string } }
  | { type: "list_hot_customers"; params: { customers: AdvisorHotCustomer[] } };

const MAX_MESSAGES = 12;
const MAX_LEN = 2000;
const OPENAI_MODEL = "gpt-4o-mini";

const RATE_LIMIT_ERROR = "Çok fazla istek gönderildi. Lütfen bir dakika sonra tekrar deneyin.";

/**
 * Kullanıcı başına dakikada 10 mesaj. Kontrol burada (bağlam sorgularından
 * ÖNCE) yapılır: 'use server' export'ları route'u atlayıp doğrudan POST
 * edilebildiğinden hız sınırı route'a değil action'a aittir; ayrıca limit
 * aşımında 13 sorguluk bağlam derlemesinin maliyeti hiç ödenmez.
 */
async function advisorRateLimited(userId: string): Promise<boolean> {
  const { allowed } = await checkRateLimit(`ai-chat:${userId}`, { limit: 10, windowSec: 60 });
  return !allowed;
}

const money = (n: number) => `₺${Math.round(n).toLocaleString("tr-TR")}`;

// ---------------------------------------------------------------------------
// Bağlam — ofisin canlı verileri (RLS zaten tenant'a sınırlar)
// ---------------------------------------------------------------------------

type HotLead = { id: string; name: string; score: number };
type OverpricedProperty = { id: string; label: string; price: number | null };

type TenantAdvisorContext = {
  customers: number;
  properties: number;
  activeDeals: number;
  wonThisMonth: number;
  wonValueThisMonth: number;
  newDemands: number;
  openTasks: number;
  tasksOverdue: number;
  tasksDueToday: number;
  todayAppointments: number;
  pendingCommission: number;
  hotLeadCount: number;
  hotLeads: HotLead[];
  overpricedCount: number;
  overpriced: OverpricedProperty[];
};

// customer_lead_signals RPC satırı — bkz. /app ve /app/musteriler'deki aynı desen
type LeadSignalRow = {
  customer_id: string;
  active_demands: number;
  comms: number;
  appts: number;
  calls: number;
  last_activity: string | null;
};

async function buildTenantContext(tenantId: string): Promise<TenantAdvisorContext> {
  const supabase = await createClient();

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

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
    { data: leadSignals },
    { data: redProperties, count: overpricedCount },
  ] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .not("stage", "in", "(won,lost)"),
    supabase
      .from("deals")
      .select("deal_value")
      .eq("stage", "won")
      .gte("updated_at", monthStart.toISOString())
      .limit(200),
    supabase
      .from("customer_demands")
      .select("id", { count: "exact", head: true })
      .eq("status", "new"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .lt("due_at", dayStart.toISOString()),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .gte("due_at", dayStart.toISOString())
      .lt("due_at", dayEnd.toISOString()),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("scheduled_at", dayStart.toISOString())
      .lt("scheduled_at", dayEnd.toISOString())
      .neq("status", "cancelled"),
    supabase
      .from("commissions")
      .select("gross_amount, status")
      .not("status", "in", "(paid,collected)")
      .limit(500),
    // Sıcak lead hesabı — dashboard/musteriler'deki lead-score deseni
    supabase
      .from("customers")
      .select("id, full_name, phone, email, source, blacklist, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.rpc("customer_lead_signals", { p_tenant_id: tenantId }),
    supabase
      .from("properties")
      .select("id, title, property_code, list_price", { count: "exact" })
      .is("deleted_at", null)
      .in("price_health", ["red", "Kırmızı"])
      .limit(5),
  ]);

  const signalMap = new Map<string, LeadSignalRow>(
    ((leadSignals ?? []) as LeadSignalRow[]).map((s) => [s.customer_id, s]),
  );

  const hotLeads: HotLead[] = [];
  for (const c of leadCustomers ?? []) {
    const s = signalMap.get(c.id);
    const { score, tier } = computeLeadScore({
      hasPhone: Boolean(c.phone),
      hasEmail: Boolean(c.email),
      source: c.source,
      activeDemands: s?.active_demands ?? 0,
      communications: s?.comms ?? 0,
      appointments: s?.appts ?? 0,
      calls: s?.calls ?? 0,
      lastActivityAt: s?.last_activity ?? null,
      createdAt: c.created_at,
      blacklist: Boolean(c.blacklist),
    });
    if (tier === "hot") hotLeads.push({ id: c.id, name: c.full_name, score });
  }
  hotLeads.sort((a, b) => b.score - a.score);

  const pendingCommission = (commissionRows ?? []).reduce(
    (sum, r) => sum + (Number(r.gross_amount) || 0),
    0,
  );
  const wonValueThisMonth = (wonDeals ?? []).reduce(
    (sum, d) => sum + (Number(d.deal_value) || 0),
    0,
  );

  return {
    customers: customers ?? 0,
    properties: properties ?? 0,
    activeDeals: activeDeals ?? 0,
    wonThisMonth: (wonDeals ?? []).length,
    wonValueThisMonth,
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

function contextToText(c: TenantAdvisorContext): string {
  return [
    `Toplam müşteri: ${c.customers} (liste: /app/musteriler)`,
    `Sıcak müşteri (öncelikli aranacaklar): ${c.hotLeadCount} (liste: /app/musteriler?sort=hot)`,
    ...c.hotLeads.map(
      (l) => `- Sıcak müşteri: ${l.name} (skor ${l.score}, detay: /app/musteriler/${l.id})`,
    ),
    `Toplam portföy: ${c.properties} (liste: /app/portfoyler)`,
    `Fiyatı piyasaya göre yüksek (riskli) portföy: ${c.overpricedCount} (liste: /app/portfoyler?saglik=riskli)`,
    ...c.overpriced.map(
      (p) =>
        `- Riskli fiyatlı portföy: ${p.label}${p.price != null ? ` (${money(p.price)})` : ""} (detay: /app/portfoyler/${p.id})`,
    ),
    `Devam eden anlaşma: ${c.activeDeals} (liste: /app/anlasmalar)`,
    `Bu ay kazanılan anlaşma: ${c.wonThisMonth} (toplam değer ${money(c.wonValueThisMonth)})`,
    `Yeni (işlenmemiş) talep: ${c.newDemands} (liste: /app/talepler)`,
    `Açık görev: ${c.openTasks} (liste: /app/gorevler)`,
    `Gecikmiş görev: ${c.tasksOverdue} (liste: /app/gorevler?filter=overdue)`,
    `Bugün vadesi gelen görev: ${c.tasksDueToday} (liste: /app/gorevler?filter=today)`,
    `Bugünkü randevu: ${c.todayAppointments} (liste: /app/randevular)`,
    `Tahsilat bekleyen komisyon: ${money(c.pendingCommission)} (liste: /app/komisyon?durum=bekleyen)`,
  ].join("\n");
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
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.4,
      max_tokens: 700,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: `OFİSİN GÜNCEL VERİLERİ:\n${contextToText(context)}` },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI boş yanıt döndü.");
  return String(content).trim();
}

// ---------------------------------------------------------------------------
// Kural tabanlı yedek yanıtlar — anahtar yoksa / hata olursa
// ---------------------------------------------------------------------------

/** Son kullanıcı mesajından konu tespiti — yedek yanıt VE yedek eylem kartları paylaşır. */
function detectTopics(messages: TenantAdvisorMessage[]) {
  const last = (messages.filter((m) => m.role === "user").pop()?.content ?? "").toLocaleLowerCase("tr-TR");
  return {
    call: /(kimi ara|aramalıyım|arayayım|sıcak|öncelik|bugün ne yap)/.test(last),
    performance: /(performans|bu ay|rapor|kazan|satış|gelir|komisyon|ciro)/.test(last),
    price: /(fiyat|pahalı|yüksek|riskli|portföy)/.test(last),
    tasks: /(görev|gecik|randevu|takvim|plan)/.test(last),
  };
}

function fallbackTenantAdvisor(messages: TenantAdvisorMessage[], c: TenantAdvisorContext): string {
  const topic = detectTopics(messages);
  const focused = topic.call || topic.performance || topic.price || topic.tasks;
  const parts: string[] = [];

  if (topic.call || !focused) {
    if (c.hotLeadCount > 0) {
      parts.push(
        `**Bugün aranacaklar:** ${c.hotLeadCount} sıcak müşterin dönüş bekliyor.\n` +
          c.hotLeads
            .map((l) => `- ${l.name} (skor ${l.score}) → /app/musteriler/${l.id}`)
            .join("\n") +
          `\nTam liste: /app/musteriler?sort=hot`,
      );
    } else {
      parts.push(
        `**Bugün aranacaklar:** Şu an sıcak müşteri görünmüyor. ${
          c.newDemands > 0
            ? `${c.newDemands} yeni talep işlenmeyi bekliyor → /app/talepler`
            : `Yeni müşteri kaydı ve talep girerek huniyi besleyebilirsin → /app/musteriler`
        }`,
      );
    }
  }

  if (topic.performance || !focused) {
    parts.push(
      `**Bu ay performansın:** ${c.wonThisMonth} anlaşma kazandın (toplam ${money(c.wonValueThisMonth)}). ` +
        `Devam eden ${c.activeDeals} anlaşman var → /app/anlasmalar. ` +
        (c.pendingCommission > 0
          ? `${money(c.pendingCommission)} komisyon tahsilat bekliyor → /app/komisyon?durum=bekleyen. `
          : "") +
        `Ayrıntılı analiz: /app/raporlar · /app/danisman-kpi`,
    );
  }

  if (topic.price || !focused) {
    if (c.overpricedCount > 0) {
      parts.push(
        `**Fiyatı yüksek portföyler:** ${c.overpricedCount} portföyün fiyat sağlığı riskli (kırmızı).\n` +
          c.overpriced
            .map((p) => `- ${p.label}${p.price != null ? ` · ${money(p.price)}` : ""} → /app/portfoyler/${p.id}`)
            .join("\n") +
          `\nTam liste: /app/portfoyler?saglik=riskli — mal sahipleriyle fiyat revizyonu görüş.`,
      );
    } else {
      parts.push(
        `**Fiyat sağlığı:** Riskli (kırmızı) fiyatlı portföyün yok — sağlıklı. Kontrol: /app/portfoyler`,
      );
    }
  }

  if (topic.tasks || !focused) {
    parts.push(
      `**Gün planı:** ` +
        (c.tasksOverdue > 0 ? `${c.tasksOverdue} gecikmiş görev var → /app/gorevler?filter=overdue. ` : "") +
        (c.tasksDueToday > 0 ? `${c.tasksDueToday} görevin bugün vadeli → /app/gorevler?filter=today. ` : "") +
        (c.todayAppointments > 0 ? `Bugün ${c.todayAppointments} randevun var → /app/randevular. ` : "") +
        (c.tasksOverdue === 0 && c.tasksDueToday === 0 && c.todayAppointments === 0
          ? "Bugün vadesi gelen görev veya randevu yok — sıcak müşterileri aramak için iyi bir gün."
          : ""),
    );
  }

  const priority: string[] = [];
  if (c.tasksOverdue > 0) priority.push(`${c.tasksOverdue} gecikmiş görevi kapat (/app/gorevler?filter=overdue)`);
  if (c.hotLeadCount > 0) priority.push(`${c.hotLeadCount} sıcak müşteriyi ara (/app/musteriler?sort=hot)`);
  if (c.newDemands > 0) priority.push(`${c.newDemands} yeni talebi eşleştir (/app/eslestirme)`);
  if (c.overpricedCount > 0) priority.push(`${c.overpricedCount} riskli fiyatlı portföyü gözden geçir (/app/portfoyler?saglik=riskli)`);

  return (
    parts.join("\n\n") +
    (priority.length
      ? `\n\n**Bugünün öncelikleri:**\n${priority.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
      : "") +
    `\n\n_Not: OpenAI anahtarı tanımlı değil — bu yanıt ofisinin canlı verilerinden kural tabanlı üretildi._`
  );
}

/**
 * Yedek kip eylem kartları — AI'lı akışla AYNI kart biçimi: "bugün kimi
 * aramalıyım" tarzı sorularda (veya genel soruda) ilk 3 sıcak müşteri için
 * hazır "Görev oluştur" önerileri üretir.
 */
function fallbackAdvisorActions(
  messages: TenantAdvisorMessage[],
  c: TenantAdvisorContext,
): AdvisorAction[] {
  const topic = detectTopics(messages);
  const focused = topic.call || topic.performance || topic.price || topic.tasks;
  if (!topic.call && focused) return [];

  return c.hotLeads.slice(0, 3).map((l) => ({
    type: "suggest_task",
    params: {
      title: `${l.name} adlı sıcak müşteriyi ara`,
      due_in_days: 1,
      customer_name: l.name,
    },
  }));
}

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

  const context = await buildTenantContext(gate.tenantId);
  const apiKey = await getOpenAiKey();

  let result: TenantAdvisorResult;
  if (apiKey) {
    try {
      result = { reply: await callOpenAI(apiKey, clean, context), usedAI: true };
    } catch (e) {
      console.error("askTenantAdvisor:openai", e);
      result = { reply: fallbackTenantAdvisor(clean, context), usedAI: false };
    }
  } else {
    result = { reply: fallbackTenantAdvisor(clean, context), usedAI: false };
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

  const context = await buildTenantContext(gate.tenantId);
  return {
    ok: true,
    tenantId: gate.tenantId,
    userId: gate.userId,
    clean,
    systemPrompt: SYSTEM_PROMPT,
    contextText: `OFİSİN GÜNCEL VERİLERİ:\n${contextToText(context)}`,
    fallbackReply: fallbackTenantAdvisor(clean, context),
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

  const c = await buildTenantContext(gate.tenantId);
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
    return { ok: false, error: res.error ?? "Görev oluşturulamadı. Lütfen tekrar deneyin." };
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
