import { financeHref, financePath } from "@/lib/finance/routes";
import { selectFaqForQuestion } from "@/lib/ai/faq-context";
import type { AdvisorScope } from "@/lib/ai/advisor-scope";
import type { FaqItem } from "@/lib/help-faq";

/**
 * Ofis asistanının YEDEK kipi (yapay zeka anahtarı yokken) — saf mantık, vitest kapsamında (B190).
 *
 * Sıra: önce NİYET eşlenir. "neden / nasıl / ne demek / nedir" kalıbındaki soru ürün kullanım sorusudur → resmî SSS
 * önceliklidir (ör. "Portföy neden taslak?" → taslak SSS'i). Ancak eşleşme yoksa ofis verisinden özet üretilir.
 * "Ciro / gelir" sorusu bu ayın TAHSİL EDİLEN komisyonuyla (ana ekran komisyon özetiyle aynı kaynak:
 * `tenant_commission_aggregates`) yanıtlanır; satış hacmi (kazanılan anlaşma bedeli) ayrı etiketle verilir.
 * Bağlantılar `[etiket](/app/...)` biçimindedir; sohbet ekranı bunları uygulama içi bağlantı olarak çizer.
 */

export type TenantAdvisorMessage = { role: "user" | "assistant"; content: string };

export type AdvisorHotCustomer = { id: string; name: string; score: number };

export type AdvisorAction =
  | { type: "suggest_task"; params: { title: string; due_in_days: number; customer_name?: string } }
  | { type: "draft_sms"; params: { customer_name: string; message: string } }
  | { type: "list_hot_customers"; params: { customers: AdvisorHotCustomer[] } };

export type HotLead = { id: string; name: string; score: number };
export type OverpricedProperty = { id: string; label: string; price: number | null };

export type TenantAdvisorContext = {
  scope: AdvisorScope;
  customers: number;
  properties: number;
  activeDeals: number;
  wonThisMonth: number;
  /** Bu ay kazanılan anlaşmaların satış bedeli toplamı (satış hacmi; ciro DEĞİL). */
  wonValueThisMonth: number;
  /** Bu ay tahsil edilen komisyon (ofis cirosu; komisyon özetiyle aynı kaynak). Komisyon izni yoksa null. */
  collectedThisMonth: number | null;
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

/** Yedek kip yanıtının sonundaki sakin açıklama (teknik ayrıntı/anahtar adı yok). */
export const FALLBACK_NOTE = "_Bu yanıt ofis verinizden otomatik hazırlandı._";

export const money = (n: number) => `₺${Math.round(n).toLocaleString("tr-TR")}`;

/** Uygulama içi bağlantı (sohbet ekranı `[etiket](/app/...)` kalıbını Link olarak çizer). */
export const link = (label: string, href: string) => `[${label}](${href})`;

function lastUserText(messages: readonly TenantAdvisorMessage[]): string {
  return messages.filter((m) => m.role === "user").pop()?.content ?? "";
}

/** Son kullanıcı mesajından niyet ve konu tespiti — yedek yanıt VE yedek eylem kartları paylaşır. */
export function detectTopics(messages: readonly TenantAdvisorMessage[]) {
  const last = lastUserText(messages).toLocaleLowerCase("tr-TR");
  return {
    /** Ürün kullanım sorusu: SSS önceliklidir. */
    howWhy: /(^|[^a-zçğıöşü])(neden|niçin|niye|nasıl|ne demek|nedir|ne işe)([^a-zçğıöşü]|$)/.test(last),
    call: /(kimi ara|aramalıyım|arayayım|sıcak|öncelik|bugün ne yap)/.test(last),
    revenue: /(ciro|gelir|hasılat|kazanç)/.test(last),
    performance: /(performans|bu ay|rapor|kazan|satış|komisyon)/.test(last),
    // "portföy" tek başına fiyat sorusu değildir (portföy durumu/taslak soruları SSS'e gider).
    price: /(fiyat|pahalı|yüksek|riskli)/.test(last),
    tasks: /(görev|gecik|randevu|takvim|plan)/.test(last),
  };
}

function isFocused(t: ReturnType<typeof detectTopics>): boolean {
  return t.call || t.revenue || t.performance || t.price || t.tasks;
}

export function fallbackTenantAdvisor(
  messages: readonly TenantAdvisorMessage[],
  c: TenantAdvisorContext,
  faq?: readonly FaqItem[],
): string {
  const topic = detectTopics(messages);
  const focused = isFocused(topic);
  const parts: string[] = [];

  // Niyet önce: "neden/nasıl" sorusu ya da konu dışı soru → resmî SSS yanıtı (eşleşme yoksa veri özetine düşer).
  if (topic.howWhy || !focused) {
    const hit = selectFaqForQuestion(lastUserText(messages), faq, 1, 3)[0];
    if (hit) return `**${hit.item.q}**\n${hit.item.a}${hit.item.href ? `\n${link("İlgili sayfayı aç", hit.item.href)}` : ""}`;
  }

  if (topic.revenue) {
    if (c.collectedThisMonth !== null) {
      parts.push(
        `**Bu ayın cirosu (tahsil edilen komisyon):** ${money(c.collectedThisMonth)}. ${link("Komisyonları aç", financePath("komisyon"))}` +
          (c.scope.deals
            ? `\nSatış hacmi (bu ay kazanılan ${c.wonThisMonth} anlaşmanın bedeli): ${money(c.wonValueThisMonth)}.`
            : ""),
      );
    } else {
      parts.push("**Ciro:** Komisyon bilgilerini görme yetkiniz yok; ofis sahibinden ya da muhasebeden isteyebilirsiniz.");
    }
  }

  if (topic.call || !focused) {
    if (c.hotLeadCount > 0) {
      parts.push(
        `**Bugün aranacaklar:** ${c.hotLeadCount} sıcak müşterin dönüş bekliyor.\n` +
          c.hotLeads.map((l) => `- ${link(l.name, `/app/musteriler/${l.id}`)} (sıcaklık ${l.score}/100)`).join("\n") +
          `\n${link("Tüm sıcak müşteriler", "/app/musteriler?sort=hot")}`,
      );
    } else {
      parts.push(
        `**Bugün aranacaklar:** Şu an sıcak müşteri görünmüyor. ${
          c.newDemands > 0
            ? `${c.newDemands} yeni talep işlenmeyi bekliyor: ${link("Talepler", "/app/talepler")}`
            : `Yeni müşteri ve talep girerek huniyi besleyebilirsin: ${link("Müşteriler", "/app/musteriler")}`
        }`,
      );
    }
  }

  if ((topic.performance && !topic.revenue) || !focused) {
    parts.push(
      `**Bu ay performansın:** ${c.wonThisMonth} anlaşma kazandın (satış hacmi ${money(c.wonValueThisMonth)}). ` +
        `Devam eden ${c.activeDeals} anlaşman var: ${link("Anlaşmalar", "/app/anlasmalar")}. ` +
        (c.pendingCommission > 0
          ? `${money(c.pendingCommission)} komisyon tahsilat bekliyor: ${link("Bekleyen komisyonlar", financeHref("komisyon", { durum: "bekleyen" }))}. `
          : "") +
        `Ayrıntı: ${link("Raporlar", "/app/raporlar")}`,
    );
  }

  if (topic.price || !focused) {
    if (c.overpricedCount > 0) {
      parts.push(
        `**Fiyatı yüksek portföyler:** ${c.overpricedCount} portföyün fiyat sağlığı riskli (kırmızı).\n` +
          c.overpriced
            .map((p) => `- ${link(p.label, `/app/portfoyler/${p.id}`)}${p.price != null ? ` · ${money(p.price)}` : ""}`)
            .join("\n") +
          `\n${link("Tüm riskli portföyler", "/app/portfoyler?saglik=riskli")} — mal sahipleriyle fiyat revizyonu görüş.`,
      );
    } else {
      parts.push(`**Fiyat sağlığı:** Riskli (kırmızı) fiyatlı portföyün yok. ${link("Portföyler", "/app/portfoyler")}`);
    }
  }

  if (topic.tasks || !focused) {
    parts.push(
      `**Gün planı:** ` +
        (c.tasksOverdue > 0 ? `${c.tasksOverdue} gecikmiş görev var: ${link("Gecikenler", "/app/gorevler?filter=overdue")}. ` : "") +
        (c.tasksDueToday > 0 ? `${c.tasksDueToday} görevin bugün vadeli: ${link("Bugünkü görevler", "/app/gorevler?filter=today")}. ` : "") +
        (c.todayAppointments > 0 ? `Bugün ${c.todayAppointments} randevun var: ${link("Randevular", "/app/randevular")}. ` : "") +
        (c.tasksOverdue === 0 && c.tasksDueToday === 0 && c.todayAppointments === 0
          ? "Bugün vadesi gelen görev veya randevu yok; sıcak müşterileri aramak için iyi bir gün."
          : ""),
    );
  }

  const priority: string[] = [];
  if (c.tasksOverdue > 0) priority.push(`${c.tasksOverdue} gecikmiş görevi kapat (${link("aç", "/app/gorevler?filter=overdue")})`);
  if (c.hotLeadCount > 0) priority.push(`${c.hotLeadCount} sıcak müşteriyi ara (${link("aç", "/app/musteriler?sort=hot")})`);
  if (c.newDemands > 0) priority.push(`${c.newDemands} yeni talebi eşleştir (${link("aç", "/app/talepler?sekme=eslesme")})`);
  if (c.overpricedCount > 0) priority.push(`${c.overpricedCount} riskli fiyatlı portföyü gözden geçir (${link("aç", "/app/portfoyler?saglik=riskli")})`);

  return (
    parts.join("\n\n") +
    (priority.length && !topic.revenue ? `\n\n**Bugünün öncelikleri:**\n${priority.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : "") +
    `\n\n${FALLBACK_NOTE}`
  );
}

/**
 * Yedek kip eylem kartları — AI'lı akışla AYNI kart biçimi: "bugün kimi aramalıyım" tarzı sorularda (veya genel soruda)
 * ilk 3 sıcak müşteri için hazır "Görev oluştur" önerileri üretir.
 */
export function fallbackAdvisorActions(messages: readonly TenantAdvisorMessage[], c: TenantAdvisorContext): AdvisorAction[] {
  const topic = detectTopics(messages);
  if (!topic.call && (isFocused(topic) || topic.howWhy)) return [];
  return c.hotLeads.slice(0, 3).map((l) => ({
    type: "suggest_task",
    params: { title: `${l.name} adlı sıcak müşteriyi ara`, due_in_days: 1, customer_name: l.name },
  }));
}
