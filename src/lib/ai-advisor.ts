import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSetting } from "@/lib/platform-settings";

export type AdvisorMessage = { role: "user" | "assistant"; content: string };

export type AdvisorContext = {
  tenantsTotal: number;
  tenantsActive: number;
  tenantsTrial: number;
  tenantsPastDue: number;
  mrr: number;
  arpa: number;
  newDemos: number;
  wonThisMonth: number;
  demoTotal: number;
  conversion: number;
  openTickets: number;
  urgentTickets: number;
  members: number;
};

export const OPENAI_MODEL = "gpt-4o-mini";

/** DB ayarı öncelikli, yoksa ortam değişkeni. */
export async function getOpenAiKey(): Promise<string | null> {
  const fromDb = await getPlatformSetting("openai_api_key");
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
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [
    { count: tenantsTotal },
    { count: tenantsActive },
    { count: tenantsTrial },
    { count: tenantsPastDue },
    { data: subs },
    { count: newDemos },
    { count: wonThisMonth },
    { count: demoTotal },
    { count: openTickets },
    { count: urgentTickets },
    { count: members },
  ] = await Promise.all([
    admin.from("tenants").select("id", { count: "exact", head: true }),
    admin.from("tenants").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("tenants").select("id", { count: "exact", head: true }).eq("status", "trial"),
    admin.from("tenants").select("id", { count: "exact", head: true }).in("status", ["past_due", "suspended"]),
    admin.from("subscriptions").select("amount_try, status").in("status", ["active", "trialing"]),
    admin.from("demo_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
    admin.from("demo_requests").select("id", { count: "exact", head: true }).eq("status", "won").gte("created_at", monthStart),
    admin.from("demo_requests").select("id", { count: "exact", head: true }),
    admin.from("support_tickets").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress", "waiting"]),
    admin.from("support_tickets").select("id", { count: "exact", head: true }).eq("priority", "urgent").in("status", ["open", "in_progress"]),
    admin.from("profiles").select("id", { count: "exact", head: true }),
  ]);

  const mrr = (subs ?? [])
    .filter((s) => s.status === "active")
    .reduce((sum, s) => sum + (Number(s.amount_try) || 0), 0);
  const activeCount = tenantsActive ?? 0;
  const arpa = activeCount > 0 ? mrr / activeCount : 0;
  const total = demoTotal ?? 0;
  const conversion = total > 0 ? Math.round(((wonThisMonth ?? 0) / total) * 100) : 0;

  return {
    tenantsTotal: tenantsTotal ?? 0,
    tenantsActive: activeCount,
    tenantsTrial: tenantsTrial ?? 0,
    tenantsPastDue: tenantsPastDue ?? 0,
    mrr,
    arpa,
    newDemos: newDemos ?? 0,
    wonThisMonth: wonThisMonth ?? 0,
    demoTotal: total,
    conversion,
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
    `Yeni demo talebi (işlenmemiş): ${c.newDemos}`,
    `Bu ay kazanılan aday: ${c.wonThisMonth}`,
    `Toplam aday: ${c.demoTotal}`,
    `Dönüşüm oranı (bu ay): %${c.conversion}`,
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

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
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
          ? ` ${c.tenantsTrial} deneme ofisi ücretliye dönerse aylık +${money(c.tenantsTrial * (c.arpa || 2490))} potansiyel var.`
          : ""),
    );
  }
  if (topic.churn || !focused) {
    if (c.tenantsPastDue > 0) {
      insights.push(
        `**Müşteri kaybı riski:** ${c.tenantsPastDue} ofis ödemesi gecikmiş/askıda. Bugün tahsilat araması yapın; ~${money(c.tenantsPastDue * (c.arpa || 2490))} aylık gelir risk altında.`,
      );
    } else {
      insights.push(`**Müşteri kaybı riski:** Şu an ödemesi geciken ofis yok — sağlıklı. Deneme bitişlerini takip ederek koruyun.`);
    }
  }
  if (topic.sales || !focused) {
    insights.push(
      `**Satış:** ${c.newDemos} işlenmemiş demo talebi, bu ay ${c.wonThisMonth} kazanım, dönüşüm %${c.conversion}.` +
        (c.newDemos > 0 ? ` İlk 1 saatte dönülen adaylarda dönüşüm ~7× artar — bekleyen ${c.newDemos} talebi hemen arayın.` : " Yeni aday akışını artırmak için tanıtım kampanyası düşünün."),
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
  if (c.newDemos > 0) priority.push(`${c.newDemos} yeni adayı ara`);
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
      console.error("runAdvisor:openai", e);
      // Anahtar geçersiz/limit → fallback'e düş
      return { reply: fallbackAdvisor(messages, context), usedAI: false };
    }
  }

  return { reply: fallbackAdvisor(messages, context), usedAI: false };
}
