/**
 * PA-8 personel çakışma yardımcıları (saf; istemci ve sunucu). Presence durumu → diğer personel listesi, yazıyor
 * olayı sözleşmesi ve gönderim öncesi "siz yazarken yeni mesaj geldi" yanıtının biçimi.
 */

/** Yanıt formu ↔ presence şeridi arasındaki pencere olayı (aynı sekme). */
export const TICKET_TYPING_EVENT = "es:ticket-typing";
export type TicketTypingDetail = { ticketId: string; typing: boolean };

export type DeskPresence = { id: string; name: string; typing: boolean };

/** `channel.presenceState()` → kendisi hariç personel (anahtar = personel kimliği; aynı kişinin çok sekmesi birleşir). */
export function othersFromPresence(state: Record<string, unknown[]>, selfId: string): DeskPresence[] {
  const out: DeskPresence[] = [];
  for (const [key, metas] of Object.entries(state ?? {})) {
    if (key === selfId || !Array.isArray(metas) || metas.length === 0) continue;
    let name = "Destek personeli";
    let typing = false;
    for (const m of metas) {
      if (!m || typeof m !== "object") continue;
      const r = m as Record<string, unknown>;
      if (typeof r.name === "string" && r.name.trim()) name = r.name.trim().slice(0, 80);
      if (r.typing === true) typing = true;
    }
    out.push({ id: key, name, typing });
  }
  return out.sort((a, b) => Number(b.typing) - Number(a.typing) || a.name.localeCompare(b.name, "tr-TR"));
}

/** Ekran okuyucu özeti: "Ayşe yazıyor, Mehmet bakıyor". */
export function presenceSummary(list: readonly DeskPresence[]): string {
  if (list.length === 0) return "";
  return list.map((p) => `${p.name} ${p.typing ? "yazıyor" : "bakıyor"}`).join(", ");
}

export type NewMessagePreview = { author: string; excerpt: string; at: string; internal: boolean };

/** Gönderim öncesi kontrol: yanıtı yazan personelin göremediği yeni mesajlar (kendi mesajı hariç). */
export function newMessagePreviews(
  rows: readonly { author_kind: string; author_user_id: string | null; body: string; visibility: string; created_at: string }[],
  selfId: string,
  names: Record<string, string>,
): NewMessagePreview[] {
  return rows
    .filter((r) => r.author_user_id !== selfId)
    .map((r) => ({
      author: r.author_kind === "system" ? "Sistem" : (r.author_user_id && names[r.author_user_id]) || (r.author_kind === "staff" ? "Destek personeli" : "Ofis kullanıcısı"),
      excerpt: r.body.replace(/\s+/g, " ").trim().slice(0, 160),
      at: r.created_at,
      internal: r.visibility === "internal",
    }));
}

/** Geçerli ISO zaman damgası mı (formdan gelen "gördüğüm son mesaj" işareti). */
export function isSeenMarker(v: unknown): v is string {
  return typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);
}
