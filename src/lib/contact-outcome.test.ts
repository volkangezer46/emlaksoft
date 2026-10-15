import { describe, expect, it } from "vitest";
import { parseTrLocalDateTime } from "@/lib/clock";
import {
  IDLE,
  PENDING_TTL_MS,
  buildContactOutcomeLog,
  callbackDueLocal,
  channelFromHref,
  parsePendingContact,
  reduceContactOutcome,
  serializeContactOutcome,
  type ContactOutcomeState,
  type PendingContact,
} from "./contact-outcome";

const T0 = Date.parse("2026-10-15T08:00:00Z"); // 11:00 TR
const base = { customerId: "c1", name: "Ayşe Yılmaz", phone: "+905321112233", channel: "call" as const, startedAt: T0 };

function launched(): ContactOutcomeState {
  return reduceContactOutcome(IDLE, { type: "launch", contact: base });
}

describe("reduceContactOutcome", () => {
  it("bağlantı → arka plan → dönüş: sonuç penceresi açılır", () => {
    let s = launched();
    expect(s.phase).toBe("pending");
    s = reduceContactOutcome(s, { type: "hidden" });
    expect(s).toMatchObject({ phase: "pending", contact: { away: true } });
    s = reduceContactOutcome(s, { type: "visible", at: T0 + 60_000 });
    expect(s).toMatchObject({ phase: "prompt", contact: { customerId: "c1" } });
  });

  it("sayfa hiç arka plana düşmediyse görünürlük olayı sormaz", () => {
    const s = reduceContactOutcome(launched(), { type: "visible", at: T0 + 1000 });
    expect(s.phase).toBe("pending");
  });

  it("süresi geçmiş temas sorulmadan düşer", () => {
    const away = reduceContactOutcome(launched(), { type: "hidden" });
    expect(reduceContactOutcome(away, { type: "visible", at: T0 + PENDING_TTL_MS + 1 })).toEqual(IDLE);
  });

  it("kapatma ve kayıt boşta duruma döner (kapatma = kayıt yok)", () => {
    const prompt = reduceContactOutcome(reduceContactOutcome(launched(), { type: "hidden" }), { type: "visible", at: T0 + 5 });
    expect(reduceContactOutcome(prompt, { type: "dismiss" })).toEqual(IDLE);
    expect(reduceContactOutcome(prompt, { type: "logged" })).toEqual(IDLE);
  });

  it("boştayken hidden/visible etkisizdir", () => {
    expect(reduceContactOutcome(IDLE, { type: "hidden" })).toBe(IDLE);
    expect(reduceContactOutcome(IDLE, { type: "visible", at: T0 })).toBe(IDLE);
  });

  it("depodan geri yükleme: arka plandaysa doğrudan sorar, değilse bekler, bozuk/eskiyse yok sayar", () => {
    const away: PendingContact = { ...base, away: true };
    expect(reduceContactOutcome(IDLE, { type: "restore", raw: JSON.stringify(away), at: T0 + 10 }).phase).toBe("prompt");
    expect(reduceContactOutcome(IDLE, { type: "restore", raw: JSON.stringify({ ...away, away: false }), at: T0 + 10 }).phase).toBe("pending");
    expect(reduceContactOutcome(IDLE, { type: "restore", raw: "{bozuk", at: T0 })).toEqual(IDLE);
    expect(reduceContactOutcome(IDLE, { type: "restore", raw: null, at: T0 })).toEqual(IDLE);
    expect(reduceContactOutcome(IDLE, { type: "restore", raw: JSON.stringify(away), at: T0 + PENDING_TTL_MS + 1 })).toEqual(IDLE);
  });

  it("serileştirme gidiş-dönüş", () => {
    const s = reduceContactOutcome(launched(), { type: "hidden" });
    const raw = serializeContactOutcome(s);
    expect(parsePendingContact(raw)).toEqual({ ...base, away: true });
    expect(serializeContactOutcome(IDLE)).toBeNull();
  });
});

describe("parsePendingContact", () => {
  it("eksik/yanlış alanları reddeder", () => {
    expect(parsePendingContact(JSON.stringify({ ...base, channel: "sms" }))).toBeNull();
    expect(parsePendingContact(JSON.stringify({ ...base, phone: "" }))).toBeNull();
    expect(parsePendingContact(JSON.stringify({ ...base, startedAt: "x" }))).toBeNull();
    expect(parsePendingContact("[]")).toBeNull();
  });
});

describe("channelFromHref", () => {
  it("tel ve WhatsApp bağlantılarını tanır", () => {
    expect(channelFromHref("tel:+905321112233")).toBe("call");
    expect(channelFromHref("https://wa.me/905321112233")).toBe("whatsapp");
    expect(channelFromHref("https://api.whatsapp.com/send?phone=90532")).toBe("whatsapp");
    expect(channelFromHref("/app/musteriler/c1")).toBeNull();
    expect(channelFromHref(null)).toBeNull();
  });
});

describe("callbackDueLocal", () => {
  it("ertesi TR günü 10:00", () => {
    expect(callbackDueLocal(T0)).toBe("2026-10-16T10:00");
    // TR 01:30 (UTC önceki gün 22:30) → TR ertesi gün
    expect(callbackDueLocal(Date.parse("2026-10-14T22:30:00Z"))).toBe("2026-10-16T10:00");
    expect(parseTrLocalDateTime(callbackDueLocal(T0))?.toISOString()).toBe("2026-10-16T07:00:00.000Z");
  });
});

describe("buildContactOutcomeLog", () => {
  const call: PendingContact = { ...base, away: true };
  const wa: PendingContact = { ...base, channel: "whatsapp", away: true };

  it("telefon + ulaşıldı: giden çağrı, Ulaşıldı kodu, görev yok", () => {
    const log = buildContactOutcomeLog(call, "reached", "  fiyat sordu ", T0);
    expect(log.call).toEqual({ customer_id: "c1", direction: "outbound", phone: base.phone, disposition: "Ulaşıldı", notes: "fiyat sordu" });
    expect(log.communication).toBeUndefined();
    expect(log.task).toBeUndefined();
  });

  it("telefon + ulaşılamadı: mevcut sözlükte Tekrar aranacak + açıklayıcı not", () => {
    const log = buildContactOutcomeLog(call, "unreached", "", T0);
    expect(log.call).toMatchObject({ disposition: "Tekrar aranacak", notes: "Ulaşılamadı." });
    expect(log.task).toBeUndefined();
  });

  it("geri ara: çağrı + yarın 10:00 arama görevi", () => {
    const log = buildContactOutcomeLog(call, "callback", "akşam müsait", T0);
    expect(log.call).toMatchObject({ disposition: "Tekrar aranacak", notes: "Geri aranacak. akşam müsait" });
    expect(log.task).toEqual({
      title: "Ayşe Yılmaz — geri ara",
      kind: "call",
      priority: "normal",
      customer_id: "c1",
      due_at: "2026-10-16T10:00",
      notes: "akşam müsait",
    });
  });

  it("WhatsApp: iletişim kaydı (konu her zaman dolu, içerik not)", () => {
    const log = buildContactOutcomeLog(wa, "reached", "", T0);
    expect(log.call).toBeUndefined();
    expect(log.communication).toEqual({
      customer_id: "c1",
      channel: "whatsapp",
      direction: "outbound",
      outcome: "mesaj_gonderildi",
      subject: "WhatsApp · Ulaşıldı",
      body: "",
    });
    expect(buildContactOutcomeLog(wa, "unreached", "", T0).communication?.outcome).toBe("ulasilamadi");
    expect(buildContactOutcomeLog(wa, "callback", "", T0).task?.due_at).toBe("2026-10-16T10:00");
  });

  it("not 1000 karakterle sınırlanır", () => {
    const log = buildContactOutcomeLog(call, "reached", "x".repeat(1500), T0);
    expect(log.call?.notes).toHaveLength(1000);
  });
});
