/** SEO sabitleri: zod'suz çekirdek (istemci editörü içe aktarır; şema ve sunucu doğrulaması schema.ts'te). */

export const CHANGE_FREQS = ["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"] as const;
export type ChangeFreq = (typeof CHANGE_FREQS)[number];

export const JSON_LD_KINDS = ["Organization", "WebSite", "SoftwareApplication", "FAQPage", "BreadcrumbList", "WebApplication"] as const;
export type JsonLdKind = (typeof JSON_LD_KINDS)[number];


export const AI_BOTS = [
  { id: "GPTBot", label: "GPTBot (OpenAI eğitim)" },
  { id: "OAI-SearchBot", label: "OAI-SearchBot (ChatGPT arama)" },
  { id: "ChatGPT-User", label: "ChatGPT-User (kullanıcı isteği)" },
  { id: "ClaudeBot", label: "ClaudeBot (Anthropic)" },
  { id: "Claude-SearchBot", label: "Claude-SearchBot (Anthropic arama)" },
  { id: "Google-Extended", label: "Google-Extended (Gemini eğitimi)" },
  { id: "CCBot", label: "CCBot (Common Crawl)" },
  { id: "PerplexityBot", label: "PerplexityBot" },
  { id: "Applebot-Extended", label: "Applebot-Extended (Apple yapay zekâ)" },
  { id: "Bytespider", label: "Bytespider (ByteDance)" },
] as const;
export type AiBotId = (typeof AI_BOTS)[number]["id"];
