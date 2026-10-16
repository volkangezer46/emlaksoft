import { describe, expect, it } from "vitest";
import { taskActionFor, telHref } from "./task-action-logic";

const base = { id: "t1", kind: "followup", status: "open", customer_id: "c1", customerPhone: "05321234567" };

describe("taskActionFor (C19: görev eyleme bağlı)", () => {
  it("eşleşen portföyleri gönder görevi Gönder akışını açar", () => {
    const a = taskActionFor({ ...base, title: "Ayşe Kaya'ya eşleşen portföyleri gönder" });
    expect(a?.type).toBe("send");
    expect(a && a.type === "send" ? a.href : "").toBe("/app/talepler?sekme=eslesme&customer=c1");
  });

  it("arama görevi telefonu varsa Ara olur", () => {
    expect(taskActionFor({ ...base, kind: "call", title: "Mehmet Bey" })?.type).toBe("call");
    expect(taskActionFor({ ...base, title: "Ahmet'i ara" })?.type).toBe("call");
    expect(taskActionFor({ ...base, title: "Mehmet Bey — geri ara" })?.type).toBe("call");
  });

  it("telefon, müşteri ya da açık durum yoksa eylem yok", () => {
    expect(taskActionFor({ ...base, kind: "call", title: "Ara", customerPhone: null })).toBeNull();
    expect(taskActionFor({ ...base, kind: "call", title: "Ara", customer_id: null })).toBeNull();
    expect(taskActionFor({ ...base, kind: "call", title: "Ara", status: "done" })).toBeNull();
    expect(taskActionFor({ ...base, title: "Tapu evrakını hazırla" })).toBeNull();
  });

  it("'arazi' gibi kelimeler arama sayılmaz", () => {
    expect(taskActionFor({ ...base, title: "Arazi ölçümü" })).toBeNull();
  });

  it("tel bağlantısı yalnız rakam taşır", () => {
    expect(telHref("0532 123 45 67")).toBe("tel:05321234567");
    expect(telHref("+49 30 1234")).toBe("tel:+49301234");
  });
});
