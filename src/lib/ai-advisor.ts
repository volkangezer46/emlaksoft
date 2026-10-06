import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSecret } from "@/lib/settings/secret-read";
import { getPlan } from "@/lib/billing/plans";
import { daysAgoIso, daysFromNowIso } from "@/lib/clock";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getOpenAiChatModel, openAiChat } from "@/lib/ai/openai-client";

export type AdvisorMessage = { role: "user" | "assistant"; content: string };

export type AdvisorContext = {
  tenantsTotal: number;
  tenantsActive: number;
  tenantsTrial: number;
  tenantsPastDue: number;
  mrr: number;
  arpa: number;
  /** Self-servis huni (demo talebi/aday takibi yok): son 30 günde açılan ofis, 7 gün içinde biten deneme, süresi geçmiş deneme. */
  newTenants30: number;
  trialsEndingSoon: number;
  trialsExpired: number;
  openTickets: number;
  urgentTickets: number;
  members: number;
};

export const OPENAI_MODEL = getOpenAiChatModel();
const OPENAI_TIMEOUT_MS = 45_000;
const OPENAI_MAX_RESPONSE_BYTES = 1024 * 1024;

/** DB ayarı öncelikli, yoksa ortam değişkeni. */
export async function getOpenAiKey(): Promise<string | null> {
  const fromDb = await getPlatformSecret("openai_api_key");
  if (fromDb && fromDb.trim()) return fromDb.trim();
  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  return fromEnv || null;
}

export async function isAiConfigured(): Promise<boolean> {
  return Boolean(await getOpenAiKey());
}

const money = (n: number) => `₺${Math.round(n).toLocaleString("tr-TR")}`;

/** Dashboard KPI'larını toplayıp danışman bağlamı üretir. */
export async function buildAdvisorContext(): Promise<AdvisorContext> {
  const admin = createAdminClient();

  const [
    { count: tenantsTotal },
    { count: tenantsActive },
    { count: tenantsTrial },
    { count: tenantsPastDue },
    { data: subs },
    { count: newTenants30 },
    { count: trialsEndingSoon },
    { count: trialsExpired },
    { count: openTickets },
    { count: urgentTickets },
    { count: members },
  ] = await Promise.all([
    admin.from("tenants").select("id", { count: "exact", head: true }),
    admin.from("tenants").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("tenants").select("id", { count: "exact", head: true }).eq("status", "trial"),
    admin.from("tenants").select("id", { count: "exact", head: true }).in("status", ["past_due", "suspended"]),
    admin.from("subscriptions").select("amount_try, status").in("status", ["active", "trialing"]),
    admin.from("tenants").select("id", { count: "exact", head: true }).gte("created_at", daysAgoIso(30)),
    admin.from("tenants").select("id", { count: "exact", head: true }).eq("status", "trial").gte("trial_ends_at", daysAgoIso(0)).lte("trial_ends_at", daysFromNowIso(7)),
    admin.from("tenants").select("id", { count: "exact", head: true }).eq("status", "trial").lt("trial_ends_at", daysAgoIso(0)),
    admin.from("support_tickets").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress", "waiting"]),
    admin.from("support_tickets").select("id", { count: "exact", head: true }).eq("priority", "urgent").in("status", ["open", "in_progress"]),
    admin.from("profiles").select("id", { count: "exact", head: true }),
  ]);

  const mrr = (subs ?? [])
    .filter((s) => s.status === "active")
    .reduce((sum, s) => sum + (Number(s.amount_try) || 0), 0);
  const activeCount = tenantsActive ?? 0;
  const arpa = activeCount > 0 ? mrr / activeCount : 0;

  return {
    tenantsTotal: tenantsTotal ?? 0,
    tenantsActive: activeCount,
    tenantsTrial: tenantsTrial ?? 0,
    tenantsPastDue: tenantsPastDue ?? 0,
    mrr,
    arpa,
    newTenants30: newTenants30 ?? 0,
    trialsEndingSoon: trialsEndingSoon ?? 0,
    trialsExpired: trialsExpired ?? 0,
    openTickets: openTickets ?? 0,
    urgentTickets: urgentTickets ?? 0,
    members: members ?? 0,
  };
}

export function contextToText(c: AdvisorContext): string {
  return [
    `Toplam ofis (tenant): ${c.tenantsTotal}`,
    `Aktif ofis: ${c.tenantsActive}`,
    `Deneme (trial) ofisi: ${c.tenantsTrial}`,
    `Ödemesi geciken/askıda: ${c.tenantsPastDue}`,
    `Aylık yinelenen gelir: ${money(c.mrr)}`,
    `Ofis başına ortalama gelir: ${money(c.arpa)}`,
    `Yıllık gelir tahmini: ${money(c.mrr * 12)}`,
    `Son 30 günde açılan ofis (self-servis kayıt): ${c.newTenants30}`,
    `Denemesi 7 gün içinde bitecek ofis: ${c.trialsEndingSoon}`,
    `Denemesi bitmiş, hâlâ ücretli pakete geçmemiş ofis: ${c.trialsExpired}`,
    `Açık destek talebi: ${c.openTickets}`,
    `Acil destek talebi: ${c.urgentTickets}`,
    `Toplam kullanıcı: ${c.members}`,
  ].join("\n");
}

export const SYSTEM_PROMPT = `Sen EmlakSoft'un yapay zeka iş danışmanısın. EmlakSoft, emlak ofisleri için bir abonelikli CRM platformudur.
Görevin: platform yöneticisine (süper admin/operasyon/muhasebe) verilen canlı verilere dayanarak
Türkçe, net, uygulanabilir iş tavsiyeleri vermek. Kısa ve öz ol, madde işaretleri kullan.
Asla tenant, lead, ticket, churn, MRR, ARR, KPI, dashboard gibi İngilizce ürün kelimeleri kullanma.
Bunların yerine: ofis, aday müşteri, destek talebi, müşteri kaybı, aylık yinelenen gelir, yıllık yinelenen gelir, gösterge, kontrol paneli.
Sayıları verilen bağlamdan al; uydurma. Somut aksiyon öner (ör. "8 deneme ofisinin X günü kaldı, arayın").
Cevapların profesyonel, samimi ve doğrudan olsun.`;

async function callOpenAI(apiKey: string, messages: AdvisorMessage[], context: AdvisorContext): Promise<string> {
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.4,
    max_tokens: 700,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `GÜNCEL PLATFORM VERİLERİ:\n${contextToText(context)}` },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  // Platform yöneticisi çağrısı: tenant yok → denetim kaydı yazılmaz (maskeleme yine uygulanır).
  const { content } = await openAiChat({
    apiKey,
    purpose: "admin_advisor",
    body: payload,
    timeoutMs: OPENAI_TIMEOUT_MS,
    maxResponseBytes: OPENAI_MAX_RESPONSE_BYTES,
  });
  if (!content) throw new Error("OpenAI boş yanıt döndü.");
  return content.trim();
}

/** OpenAI anahtarı yoksa çalışan kural-tabanlı danışman. Bağlama göre içgörü üretir. */
export function fallbackAdvisor(messages: AdvisorMessage[], c: AdvisorContext): string {
  const last = (messages.filter((m) => m.role === "user").pop()?.content ?? "").toLocaleLowerCase("tr-TR");
  const insights: string[] = [];

  const topic = {
    revenue: /(gelir|mrr|arr|ciro|kazan|para|abonelik)/.test(last),
    churn: /(churn|kayıp|risk|iptal|gecik|askı|terk)/.test(last),
    sales: /(satış|lead|aday|demo|dönüşüm|müşteri kazan|pipeline|huni)/.test(last),
    support: /(destek|ticket|talep|şikayet|memnuniyet)/.test(last),
  };
  const focused = topic.revenue || topic.churn || topic.sales || topic.support;

  if (topic.revenue || !focused) {
    insights.push(
      `**Gelir:** Aylık yinelenen gelir ${money(c.mrr)} · yıllık tahmin ${money(c.mrr * 12)} · ofis başına ${money(c.arpa)}.` +
        (c.tenantsTrial > 0
          ? ` ${c.tenantsTrial} deneme ofisi ücretliye dönerse aylık +${money(c.tenantsTrial * (c.arpa || getPlan("office").monthlyTry))} potansiyel var.`
          : ""),
    );
  }
  if (topic.churn || !focused) {
    if (c.tenantsPastDue > 0) {
      insights.push(
        `**Müşteri kaybı riski:** ${c.tenantsPastDue} ofis ödemesi gecikmiş/askıda. Bugün tahsilat araması yapın; ~${money(c.tenantsPastDue * (c.arpa || getPlan("office").monthlyTry))} aylık gelir risk altında.`,
      );
    } else {
      insights.push(`**Müşteri kaybı riski:** Şu an ödemesi geciken ofis yok — sağlıklı. Deneme bitişlerini takip ederek koruyun.`);
    }
  }
  if (topic.sales || !focused) {
    insights.push(
      `**Self-servis huni:** son 30 günde ${c.newTenants30} yeni ofis; ${c.trialsEndingSoon} ofisin denemesi 7 gün içinde bitiyor, ${c.trialsExpired} ofisin denemesi bitti ama ücretli pakete geçmedi.` +
        (c.trialsEndingSoon > 0 ? " Denemesi bitmek üzere olan ofislerin kurulum ve kullanım durumuna bakın." : " Deneme bitişleri şu an sakin."),
    );
  }
  if (topic.support || !focused) {
    insights.push(
      `**Destek:** ${c.openTickets} açık talep${c.urgentTickets > 0 ? `, bunların ${c.urgentTickets} tanesi ACİL` : ""}.` +
        (c.urgentTickets > 0 ? " Acil talepleri önceliklendirin; geciken yanıt müşteri kaybını tetikler." : " Kuyruk kontrol altında."),
    );
  }

  const priority: string[] = [];
  if (c.urgentTickets > 0) priority.push(`${c.urgentTickets} acil destek talebini çöz`);
  if (c.tenantsPastDue > 0) priority.push(`${c.tenantsPastDue} geciken ödemeyi tahsil et`);
  if (c.trialsEndingSoon > 0) priority.push(`denemesi bitmek üzere olan ${c.trialsEndingSoon} ofisi incele`);
  if (c.tenantsTrial > 0) priority.push(`${c.tenantsTrial} deneme ofisini dönüşüme hazırla`);

  return (
    `${insights.join("\n\n")}` +
    (priority.length
      ? `\n\n**Bugünün öncelikleri:**\n${priority.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
      : "") +
    `\n\n_Not: OpenAI anahtarı tanımlı değil — bu yanıt canlı verilerden kural-tabanlı üretildi. Serbest sohbet için Sistem → Yapay zeka ayarlarından anahtar ekleyin._`
  );
}

export type AdvisorResult = { reply: string; usedAI: boolean };

export async function runAdvisor(messages: AdvisorMessage[]): Promise<AdvisorResult> {
  const context = await buildAdvisorContext();
  const apiKey = await getOpenAiKey();

  if (apiKey) {
    try {
      const reply = await callOpenAI(apiKey, messages, context);
      return { reply, usedAI: true };
    } catch (e) {
      console.error("runAdvisor:openai", externalErrorMetadata(e));
      // Anahtar geçersiz/limit → fallback'e düş
      return { reply: fallbackAdvisor(messages, context), usedAI: false };
    }
  }

  return { reply: fallbackAdvisor(messages, context), usedAI: false };
}
