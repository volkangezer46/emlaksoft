import { extractNumbers, normalizeNumber } from "@/lib/ai/narrative-guard";

/**
 * Sesli not -> AI özet (SAF mantık). Akış: tarayıcı MediaRecorder -> sunucu transkript (openai-client) -> özet (openAiChat,
 * metin maskelenerek) -> kullanıcı taslağı onaylar -> NOT olarak kaydedilir. SES DOSYASI SAKLANMAZ (yalnız bellekte işlenir); kayda
 * yalnız metin (özet + transkript) yazılır.
 */

export const VOICE_NOTE_MAX_SECONDS = 180;
export const VOICE_NOTE_MAX_BYTES = 3 * 1024 * 1024;
export const VOICE_NOTE_MAX_TEXT = 4000;

const ALLOWED = /^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a|aac)(;.*)?$/i;

export function isAllowedAudioType(type: string | null | undefined): boolean {
  return ALLOWED.test(String(type ?? "").trim());
}

export function fileNameForAudio(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("ogg")) return "not.ogg";
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "not.m4a";
  if (t.includes("mpeg")) return "not.mp3";
  if (t.includes("wav")) return "not.wav";
  return "not.webm";
}

export function buildVoiceSummaryMessages(transcript: string): { system: string; user: string } {
  return {
    system:
      "Sen bir emlak ofisi danışman asistanısın. Sana bir görüşme/randevu sonrası sesli notun yazıya dökülmüş hâli verilecek. " +
      "Türkçe, en fazla 5 kısa madde (her satır '- ' ile başlasın) halinde özetle: konuşulanlar, müşterinin beklentisi, verilen sözler, sonraki adım. " +
      "YALNIZCA metinde geçen bilgiyi kullan; isim, fiyat, tarih veya sayı UYDURMA. Emoji kullanma.",
    user: transcript,
  };
}

export type VoiceCheck = { ok: true; text: string } | { ok: false; error: string };

/** Özet kabul/ret: boş, aşırı uzun veya transkriptte olmayan sayı içeren çıktı reddedilir. */
export function checkVoiceSummary(output: string | null | undefined, transcript: string): VoiceCheck {
  const text = (output ?? "").trim();
  if (!text) return { ok: false, error: "Özet üretilemedi." };
  if (text.length > Math.max(600, transcript.length)) return { ok: false, error: "Özet beklenenden uzun; güvenlik için reddedildi." };
  const allowed = new Set(extractNumbers(transcript).map(normalizeNumber));
  if (extractNumbers(text).map(normalizeNumber).some((n) => !allowed.has(n))) {
    return { ok: false, error: "Özette konuşmada olmayan sayılar var; güvenlik için reddedildi." };
  }
  return { ok: true, text };
}

/** Kaydedilecek not gövdesi (özet + transkript). */
export function formatVoiceNote(i: { summary: string; transcript: string; stamp: string }): string {
  const parts = [`[${i.stamp}] Sesli not (AI özeti, onaylandı)`, i.summary.trim()];
  if (i.transcript.trim()) parts.push("", "Transkript:", i.transcript.trim());
  return parts.join("\n").slice(0, VOICE_NOTE_MAX_TEXT);
}
