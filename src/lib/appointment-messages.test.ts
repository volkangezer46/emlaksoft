import { describe, expect, it } from "vitest";
import {
  appointmentConfirmUrl,
  appointmentCustomerText,
  appointmentReminderRecipient,
  appointmentWhatsAppHref,
  isCustomerMessageHour,
  appointmentNoShowText,
  planAdvisorReminders,
  rescheduleResetPatch,
  shouldRemindCustomer,
  type ReminderAppointment,
} from "@/lib/appointment-messages";

const base: ReminderAppointment = {
  id: "a1",
  tenant_id: "t1",
  scheduled_at: "2026-10-15T11:30:00.000Z", // 14:30 TR
  confirm_token: "tok-1",
  assigned_to: null,
  created_by: null,
  customerName: "Ayşe Yılmaz",
};

describe("danışman hatırlatması hedefi", () => {
  it("atanan > açan > yok", () => {
    expect(appointmentReminderRecipient({ assigned_to: "u1", created_by: "u2" })).toBe("u1");
    expect(appointmentReminderRecipient({ assigned_to: null, created_by: "u2" })).toBe("u2");
    expect(appointmentReminderRecipient({ assigned_to: null, created_by: null })).toBeNull();
  });

  it("plan: her satır kişiye yazılır, sahipsiz atlanır, zaten bildirilen atlanır", () => {
    const plan = planAdvisorReminders(
      [
        { ...base, id: "a1", assigned_to: "u1" },
        { ...base, id: "a2", created_by: "u2" },
        { ...base, id: "a3" },
        { ...base, id: "a4", assigned_to: "u4" },
      ],
      { appUrl: "https://app.test/", isAlreadyNotified: (a) => a.id === "a4" },
    );
    expect(plan.rows.map((r) => [r.href, r.user_id])).toEqual([
      ["/app/randevular?randevu=a1", "u1"],
      ["/app/randevular?randevu=a2", "u2"],
    ]);
    expect(plan.unowned).toBe(1);
    expect(plan.skipped).toBe(1);
    expect(plan.rows[0]!.body).toBe("Ayşe Yılmaz · 15 Ekim 14:30 · Teyit: https://app.test/randevu-teyit/tok-1");
    expect(plan.rows[0]!.dedupe_key).toBe(`appt-hatirlat:a1:${new Date(base.scheduled_at).getTime()}`);
  });
});

describe("müşteri iletisi", () => {
  it("teyit metni Türkiye saatiyle, ofis ve tür adıyla, teyit bağlantısıyla", () => {
    const text = appointmentCustomerText({
      kind: "confirm",
      customerName: "Ayşe Yılmaz",
      officeName: "Vadi Emlak",
      appointmentType: "showing",
      scheduledAt: base.scheduled_at,
      confirmUrl: appointmentConfirmUrl("https://app.test", "tok-1"),
    });
    expect(text).toBe("Merhaba Ayşe, Vadi Emlak ile 15 Ekim 14:30 yer gösterme randevunuz planlandı. Teyit veya iptal için: https://app.test/randevu-teyit/tok-1");
  });

  it("hatırlatma metni; bağlantı yoksa yalnız bilgi", () => {
    const text = appointmentCustomerText({ kind: "reminder", customerName: null, officeName: null, appointmentType: null, scheduledAt: base.scheduled_at, confirmUrl: null });
    expect(text).toBe("Merhaba, hatırlatma: 15 Ekim 14:30 randevunuz yaklaşıyor.");
  });

  it("WhatsApp taslağı müşterinin numarasına ve aynı metinle açılır", () => {
    const text = "Merhaba Ayşe, teyit: https://app.test/randevu-teyit/tok-1";
    expect(appointmentWhatsAppHref("05321234567", text)).toBe(`https://wa.me/905321234567?text=${encodeURIComponent(text)}`);
    expect(appointmentWhatsAppHref("+4915123456789", "x")).toBe("https://wa.me/4915123456789?text=x");
    expect(appointmentWhatsAppHref(null, text)).toBeNull();
  });

  it("gece mesaj atılmaz (09:00–21:00 TR)", () => {
    expect(isCustomerMessageHour(Date.parse("2026-10-15T05:59:00Z"))).toBe(false); // 08:59
    expect(isCustomerMessageHour(Date.parse("2026-10-15T06:00:00Z"))).toBe(true); // 09:00
    expect(isCustomerMessageHour(Date.parse("2026-10-15T17:59:00Z"))).toBe(true); // 20:59
    expect(isCustomerMessageHour(Date.parse("2026-10-15T18:00:00Z"))).toBe(false); // 21:00
  });

  it("hatırlatma kararı: tek sefer, açık randevu, iptal etmemiş müşteri, yakın teyit yok", () => {
    const nowMs = Date.parse("2026-10-14T09:00:00Z"); // 12:00 TR
    const c = {
      status: "pending",
      customer_response: null,
      customer_reminded_at: null,
      customer_confirm_sent_at: null,
      scheduled_at: "2026-10-15T06:00:00Z",
      hasMobile: true,
    };
    expect(shouldRemindCustomer(c, nowMs)).toBe(true);
    expect(shouldRemindCustomer({ ...c, hasMobile: false }, nowMs)).toBe(false);
    expect(shouldRemindCustomer({ ...c, customer_reminded_at: "2026-10-14T08:00:00Z" }, nowMs)).toBe(false);
    expect(shouldRemindCustomer({ ...c, status: "completed" }, nowMs)).toBe(false);
    expect(shouldRemindCustomer({ ...c, customer_response: "cancelled" }, nowMs)).toBe(false);
    expect(shouldRemindCustomer({ ...c, customer_confirm_sent_at: "2026-10-14T03:00:00Z" }, nowMs)).toBe(false);
    expect(shouldRemindCustomer({ ...c, customer_confirm_sent_at: "2026-10-13T09:00:00Z" }, nowMs)).toBe(true);
    expect(shouldRemindCustomer({ ...c, scheduled_at: "2026-10-14T08:00:00Z" }, nowMs)).toBe(false);
  });
});

describe("yeniden planlama (GA-01)", () => {
  const at = "2026-10-15T11:30:00.000Z";
  it("saat değişince teyit/hatırlatma izleri sıfırlanır; teyitli randevu beklemeye döner", () => {
    expect(rescheduleResetPatch({ scheduled_at: at, status: "confirmed" }, "2026-10-16T08:00:00.000Z")).toEqual({
      customer_response: null,
      responded_at: null,
      customer_reminded_at: null,
      customer_confirm_sent_at: null,
      status: "pending",
    });
    expect(rescheduleResetPatch({ scheduled_at: at, status: "pending" }, "2026-10-16T08:00:00.000Z")).not.toHaveProperty("status");
  });
  it("aynı saatte not düzenleme ve kapalı randevu sıfırlamaz", () => {
    expect(rescheduleResetPatch({ scheduled_at: at, status: "confirmed" }, "2026-10-15T14:30:00+03:00")).toBeNull();
    expect(rescheduleResetPatch({ scheduled_at: at, status: "completed" }, "2026-10-16T08:00:00.000Z")).toBeNull();
    expect(rescheduleResetPatch({ scheduled_at: at, status: "cancelled" }, "2026-10-16T08:00:00.000Z")).toBeNull();
  });
  it("müşteri metni eski ve yeni saati içerir", () => {
    const text = appointmentCustomerText({
      kind: "reschedule",
      customerName: "Ayşe Yılmaz",
      officeName: "Deniz Emlak",
      appointmentType: "showing",
      scheduledAt: "2026-10-16T08:00:00.000Z",
      previousAt: at,
      confirmUrl: "https://app.test/randevu-teyit/x",
    });
    expect(text).toContain("15 Ekim 14:30 yerine");
    expect(text).toContain("16 Ekim 11:00 olarak güncellendi");
    expect(text).toContain("https://app.test/randevu-teyit/x");
  });
  it("gelmedi taslağı nazik ve tarihli (GA-14)", () => {
    const text = appointmentNoShowText({ customerName: "Ayşe Yılmaz", officeName: "Deniz Emlak", scheduledAt: at });
    expect(text).toContain("Merhaba Ayşe");
    expect(text).toContain("15 Ekim 14:30");
  });
});
