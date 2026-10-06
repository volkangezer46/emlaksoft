/** Eylemli asistan önizleme metni (istemci güvenli; zod içermez). */
import type { AssistantProposal } from "@/lib/ai/assistant-actions";

/** Onay ekranında gösterilecek özet satırları. */
export function describeProposal(p: AssistantProposal): string[] {
  switch (p.type) {
    case "task":
      return [`Görev: ${p.title}`, `Vade: ${p.dueInDays === 0 ? "bugün" : `${p.dueInDays} gün sonra`}`, ...(p.note ? [`Not: ${p.note}`] : [])];
    case "followup_plan":
      return [`Takip planı: ${p.title}`, ...p.steps.map((s, i) => `${i + 1}. ${s.dayOffset === 0 ? "Bugün" : `${s.dayOffset}. gün`}: ${s.title}`)];
    case "message_draft":
      return [`Mesaj taslağı (${p.channel === "sms" ? "SMS" : "WhatsApp"}) · kitle: ${p.audience}`, p.message];
  }
}
