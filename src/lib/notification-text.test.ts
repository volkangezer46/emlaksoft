import { describe, expect, it } from "vitest";
import { notificationHref, notificationMarker, stripNotificationMarker, taskListHref } from "./notification-text";

const ID = "3f2b8c1e-9a4d-4e5f-8b6a-1c2d3e4f5a6b";

describe("stripNotificationMarker", () => {
  it("gövde sonundaki makine izini siler", () => {
    expect(stripNotificationMarker(`Sözleşmeyi gönder · 29.09.2026 10:00 · task:${ID}`)).toBe("Sözleşmeyi gönder · 29.09.2026 10:00");
    expect(stripNotificationMarker(`Ayşe Kaya · 29.09.2026 14:30 · appt:${ID}`)).toBe("Ayşe Kaya · 29.09.2026 14:30");
    expect(stripNotificationMarker(`Gecikme · dunsub:${ID}`)).toBe("Gecikme");
  });

  it("iz yoksa ya da ortadaysa dokunmaz; null korunur", () => {
    expect(stripNotificationMarker("Yeni talep geldi")).toBe("Yeni talep geldi");
    expect(stripNotificationMarker(`task:${ID} · sonra`)).toBe(`task:${ID} · sonra`);
    expect(stripNotificationMarker(null)).toBeNull();
  });

  it("izi okur (tür + kimlik)", () => {
    expect(notificationMarker(`x · task:${ID}`)).toEqual({ kind: "task", id: ID });
    expect(notificationMarker("x")).toBeNull();
  });
});

describe("notificationHref", () => {
  it("görev: başlıkla süzülmüş görev listesine götürür (başlıkta ' · ' olsa da)", () => {
    expect(notificationHref({ href: "/app/gorevler", body: `Ara · tekrar · 29.09.2026 10:00 · task:${ID}` })).toBe(
      `/app/gorevler?q=${encodeURIComponent("Ara · tekrar")}`,
    );
  });

  it("randevu: müşteri adıyla süzülmüş randevu listesi; ad bilinmiyorsa mevcut bağlantı", () => {
    expect(
      notificationHref({ href: "/app/randevular", body: `Ayşe Kaya · 29.09.2026 14:30 · Teyit: https://x/randevu-teyit/t · appt:${ID}` }),
    ).toBe(`/app/randevular?q=${encodeURIComponent("Ayşe Kaya")}`);
    expect(notificationHref({ href: "/app/randevular", body: `Müşteri · 29.09.2026 14:30 · appt:${ID}` })).toBe("/app/randevular");
  });

  it("desteklenmeyen tür, özel href ya da izsiz gövde: mevcut href kalır", () => {
    expect(notificationHref({ href: "/app/anahtarlar", body: `Anahtar · anahtar:${ID}` })).toBe("/app/anahtarlar");
    expect(notificationHref({ href: "/app/gorevler/ozel", body: `X · task:${ID}` })).toBe("/app/gorevler/ozel");
    expect(notificationHref({ href: null, body: "Duyuru" })).toBeNull();
    expect(notificationHref({ href: "/app/gorevler", body: null })).toBe("/app/gorevler");
  });

  it("taskListHref boş başlıkta listeye düşer, uzunu 80 karaktere kırpar", () => {
    expect(taskListHref("  ")).toBe("/app/gorevler");
    expect(taskListHref("a".repeat(100))).toBe(`/app/gorevler?q=${"a".repeat(80)}`);
  });
});
