/**
 * Temas sonrası sonuç kaydı — saf durum makinesi (istemci bileşeni: components/app/call-outcome.tsx).
 *
 * Akış: danışman müşteri listesinde tel:/wa.me bağlantısına dokunur → "bekleyen temas" (pending) saklanır →
 * sayfa arka plana düşer (telefon/WhatsApp açıldı, `away`) → sayfa yeniden görünür olunca kısa bir sonuç penceresi
 * açılır (prompt). Danışman Ulaşıldı / Ulaşılamadı / Geri ara seçer → çağrı ya da WhatsApp iletişim kaydı
 * (geri aramada ek olarak yarın 10:00 görevi) atılır. Pencereyi kapatmak hiçbir şey kaydetmez.
 *
 * Bağlantı tıklaması hiçbir koşulda engellenmez; bu modül yalnız durumu ve kayıt alanlarını üretir.
 */

import { DAY_MS, trDayKey } from "@/lib/clock";

export type ContactChannel = "call" | "whatsapp";
export type ContactOutcome = "reached" | "unreached" | "callback";

export type PendingContact = {
  customerId: string;
  name: string;
  phone: string;
  channel: ContactChannel;
  /** Bağlantıya dokunulan an (epoch ms). */
  startedAt: number;
  /** Sayfa en az bir kez arka plana düştü mü (telefon/WhatsApp gerçekten açıldı). */
  away: boolean;
};

export type ContactOutcomeState =
  | { phase: "idle" }
  | { phase: "pending"; contact: PendingContact }
  | { phase: "prompt"; contact: PendingContact };

export type ContactOutcomeEvent =
  | { type: "launch"; contact: Omit<PendingContact, "away"> }
  | { type: "hidden" }
  | { type: "visible"; at: number }
  | { type: "restore"; raw: string | null; at: number }
  | { type: "dismiss" }
  | { type: "logged" };

export const CONTACT_OUTCOME_STORAGE_KEY = "emlaksoft:contact-outcome";
/** Bu süreden eski bekleyen temas için sonuç sorulmaz (unutulmuş sekme). */
export const PENDING_TTL_MS = 2 * 3_600_000;
export const NOTE_MAX = 1000;

export const IDLE: ContactOutcomeState = { phase: "idle" };

export const CONTACT_OUTCOME_LABELS: Record<ContactOutcome, string> = {
  reached: "Ulaşıldı",
  unreached: "Ulaşılamadı",
  callback: "Geri ara",
};

function isFresh(contact: PendingContact, at: number): boolean {
  return at - contact.startedAt >= 0 && at - contact.startedAt <= PENDING_TTL_MS;
}

export function reduceContactOutcome(state: ContactOutcomeState, event: ContactOutcomeEvent): ContactOutcomeState {
  switch (event.type) {
    case "launch":
      // Açık sonuç penceresi varken yeni temas başlatılamaz (modal); yine de gelirse eskisi sessizce düşer.
      return { phase: "pending", contact: { ...event.contact, away: false } };
    case "hidden":
      if (state.phase !== "pending" || state.contact.away) return state;
      return { phase: "pending", contact: { ...state.contact, away: true } };
    case "visible":
      if (state.phase !== "pending" || !state.contact.away) return state;
      return isFresh(state.contact, event.at) ? { phase: "prompt", contact: state.contact } : IDLE;
    case "restore": {
      if (state.phase !== "idle") return state;
      const contact = parsePendingContact(event.raw);
      if (!contact || !isFresh(contact, event.at)) return IDLE;
      // Sayfa arka plandayken yeniden yüklendiyse (mobil sekme atma) dönüşte doğrudan sorulur.
      return contact.away ? { phase: "prompt", contact } : { phase: "pending", contact };
    }
    case "dismiss":
    case "logged":
      return IDLE;
  }
}

/** sessionStorage'a yazılacak değer; null → anahtar silinir. */
export function serializeContactOutcome(state: ContactOutcomeState): string | null {
  return state.phase === "idle" ? null : JSON.stringify(state.contact);
}

export function parsePendingContact(raw: string | null): PendingContact | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.customerId !== "string" || !o.customerId) return null;
  if (typeof o.phone !== "string" || !o.phone) return null;
  if (o.channel !== "call" && o.channel !== "whatsapp") return null;
  if (typeof o.startedAt !== "number" || !Number.isFinite(o.startedAt)) return null;
  return {
    customerId: o.customerId,
    name: typeof o.name === "string" ? o.name : "",
    phone: o.phone,
    channel: o.channel,
    startedAt: o.startedAt,
    away: o.away === true,
  };
}

/** Bağlantı adresinden kanal: tel: → çağrı, wa.me / WhatsApp → whatsapp; diğerleri izlenmez. */
export function channelFromHref(href: string | null | undefined): ContactChannel | null {
  const h = (href ?? "").trim().toLowerCase();
  if (h.startsWith("tel:")) return "call";
  if (/^https?:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//.test(h) || h.startsWith("whatsapp:")) return "whatsapp";
  return null;
}

/** Geri arama görevinin termini: ertesi TR günü 10:00 (ofis saati), `datetime-local` biçiminde. */
export function callbackDueLocal(nowMs: number): string {
  return `${trDayKey(nowMs + DAY_MS)}T10:00`;
}

export type ContactOutcomeLog = {
  /** createCall alanları (telefon kanalı). */
  call?: Record<string, string>;
  /** createCommunication alanları (WhatsApp kanalı). */
  communication?: Record<string, string>;
  /** createTask alanları (yalnız geri arama). */
  task?: Record<string, string>;
};

/** Çağrı sonuç kodları gelen kutusu sözlüğünden (CALL_DISPOSITIONS): "Ulaşıldı" / "Tekrar aranacak". */
const CALL_DISPOSITION: Record<ContactOutcome, string> = {
  reached: "Ulaşıldı",
  unreached: "Tekrar aranacak",
  callback: "Tekrar aranacak",
};

/** WhatsApp iletişim sonucu COMM_OUTCOMES sözlüğünden. */
const COMM_OUTCOME: Record<ContactOutcome, string> = {
  reached: "mesaj_gonderildi",
  unreached: "ulasilamadi",
  callback: "geri_aranacak",
};

export function buildContactOutcomeLog(
  contact: PendingContact,
  outcome: ContactOutcome,
  rawNote: string,
  nowMs: number,
): ContactOutcomeLog {
  const note = rawNote.trim().slice(0, NOTE_MAX);
  const label = CONTACT_OUTCOME_LABELS[outcome];
  const out: ContactOutcomeLog = {};

  if (contact.channel === "call") {
    // "Ulaşılamadı" için ayrı sonuç kodu yok: "Tekrar aranacak" + açıklayıcı not.
    const prefix = outcome === "reached" ? "" : outcome === "unreached" ? "Ulaşılamadı." : "Geri aranacak.";
    out.call = {
      customer_id: contact.customerId,
      direction: "outbound",
      phone: contact.phone,
      disposition: CALL_DISPOSITION[outcome],
      notes: [prefix, note].filter(Boolean).join(" "),
    };
  } else {
    out.communication = {
      customer_id: contact.customerId,
      channel: "whatsapp",
      direction: "outbound",
      outcome: COMM_OUTCOME[outcome],
      subject: `WhatsApp · ${label}`,
      body: note,
    };
  }

  if (outcome === "callback") {
    out.task = {
      title: `${contact.name || "Müşteri"} — geri ara`.slice(0, 200),
      kind: "call",
      priority: "normal",
      customer_id: contact.customerId,
      due_at: callbackDueLocal(nowMs),
      notes: note,
    };
  }
  return out;
}
