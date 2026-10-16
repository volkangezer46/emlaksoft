/**
 * "Uygun ilanlar" kartından TEK WhatsApp iletisi (SAF; sadeleştirme planı C14). Seçilen her ilan kendi token'lı paylaşım
 * bağlantısıyla (sendMatchToCustomer) tek mesajda gider. Kişisel veri metne girmez; yalnız müşterinin ilk adı.
 * Tek ilan için metin, tekil gönderim mesajıyla (buildMatchShareMessage) aynı dili konuşur.
 */
import { formatTry } from "@/lib/format";

export type MatchSendItem = { title: string; listPrice: number | null; url: string };

/** Uyum etiketi: birimsiz puan yerine sade Türkçe (≥ 75 "Çok uygun", diğer gösterilenler "Uygun"). */
export function matchFitLabel(tier: "strong" | "good" | "weak" | "none"): "Çok uygun" | "Uygun" {
  return tier === "strong" ? "Çok uygun" : "Uygun";
}

export function buildMultiMatchMessage(input: {
  customerName: string | null;
  items: readonly MatchSendItem[];
  advisorName?: string | null;
  officeName?: string | null;
}): string {
  const first = (input.customerName ?? "").trim().split(/\s+/)[0] ?? "";
  const sign = [input.advisorName?.trim(), input.officeName?.trim()].filter(Boolean).join(" · ");
  const n = input.items.length;
  const lines: string[] = [`Merhaba${first ? ` ${first}` : ""},`];
  lines.push(
    n === 1
      ? "aradığınız kriterlere uyan bir ilanı sizin için seçtim. Fotoğraflar ve ayrıntılar:"
      : `aradığınız kriterlere uyan ${n} ilanı sizin için seçtim. Fotoğraflar ve ayrıntılar:`,
  );
  input.items.forEach((it, i) => {
    const price = it.listPrice != null && it.listPrice > 0 ? ` (${formatTry(it.listPrice)})` : "";
    const title = it.title.trim() || "İlan";
    lines.push("", n === 1 ? `${title}${price}` : `${i + 1}) ${title}${price}`, it.url);
  });
  lines.push("", "Görmek istediğiniz olursa uygun olduğunuz bir zamanı yazmanız yeterli.");
  if (sign) lines.push(sign);
  return lines.join("\n");
}
