import { describe, expect, it } from "vitest";
import { isDecisionNotification, splitDecisionFirst } from "./notification-decision";
import { isDecisionNotification as bellRule } from "@/components/app/notification-bell";

const SAMPLES = [
  { href: "/app/onaylar?durum=bekliyor", title: "Komisyon indirimi onay bekliyor" },
  { href: "/app/onaylar", title: "Talebiniz onaylandı" },
  { href: "/app/musteriler/1", title: "Size yeni müşteri atandı" },
  { href: "/app/gorevler?gorev=1", title: "Görev gecikti" },
  { href: "/app/randevular?randevu=1", title: "Yeni randevu talebi" },
  { href: "/app/portfoyler/1", title: "Portföy fiyatı güncellendi" },
  { href: null, title: "Sistem bakımı" },
] as const;

describe("karar bildirimi tek kuralı (C22)", () => {
  it("zil rozetiyle aynı sonucu verir", () => {
    for (const s of SAMPLES) expect(isDecisionNotification(s), s.title).toBe(bellRule(s));
  });

  it("onay, atama ve gecikme kararlıdır; bilgi bildirimi değildir", () => {
    expect(isDecisionNotification(SAMPLES[0])).toBe(true);
    expect(isDecisionNotification(SAMPLES[2])).toBe(true);
    expect(isDecisionNotification(SAMPLES[3])).toBe(true);
    expect(isDecisionNotification(SAMPLES[5])).toBe(false);
    expect(isDecisionNotification(SAMPLES[6])).toBe(false);
  });

  it("splitDecisionFirst: yalnız OKUNMAMIŞ karar bildirimleri öne, sıra korunur, sınır uygulanır", () => {
    const rows = [
      { id: "a", href: "/app/portfoyler/1", title: "Bilgi", read_at: null },
      { id: "b", href: "/app/onaylar", title: "Onay", read_at: null },
      { id: "c", href: "/app/gorevler", title: "Görev gecikti", read_at: "2026-10-01" },
      { id: "d", href: null, title: "Müşteri atandı", read_at: null },
    ];
    const { decisions, rest } = splitDecisionFirst(rows);
    expect(decisions.map((r) => r.id)).toEqual(["b", "d"]);
    expect(rest.map((r) => r.id)).toEqual(["a", "c"]);
    expect(splitDecisionFirst(rows, 1).decisions.map((r) => r.id)).toEqual(["b"]);
  });
});
