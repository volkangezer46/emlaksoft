import { describe, expect, it } from "vitest";
import { needsTurkishEncoding, simplifyForSms, smsInfo, stripTurkishChars } from "./sms-segments";

describe("smsInfo", () => {
  it("salt GSM-7 metin 160/153", () => {
    expect(smsInfo("Merhaba").encoding).toBe("gsm7");
    expect(smsInfo("a".repeat(306)).segments).toBe(2);
    expect(smsInfo("a".repeat(307)).segments).toBe(3);
  });
  it("genişletilmiş karakter 2 birim sayılır", () => {
    expect(smsInfo("€".repeat(80)).units).toBe(160);
    expect(smsInfo("€".repeat(81)).segments).toBe(2);
  });
  it("Türkçe karakter UCS-2'ye düşmez: 155/149", () => {
    const i = smsInfo("Şişli'de yeni daire");
    expect(i.encoding).toBe("tr");
    expect(needsTurkishEncoding("Şişli")).toBe(true);
    expect(needsTurkishEncoding("Ozel")).toBe(false);
    expect(smsInfo("ı".repeat(298)).segments).toBe(2);
    expect(smsInfo("ı".repeat(299)).segments).toBe(3);
  });
  it("emoji ya da akıllı tırnak Unicode'a düşürür", () => {
    expect(smsInfo("Merhaba 🏠").encoding).toBe("ucs2");
    expect(smsInfo("“Fırsat”").encoding).toBe("ucs2");
    expect(smsInfo(simplifyForSms("“Fırsat”")).encoding).toBe("tr");
  });
  it("Türkçe sadeleştirme GSM-7'ye indirir", () => {
    expect(stripTurkishChars("Şişli'de ığdır")).toBe("Sisli'de igdir");
    expect(smsInfo(stripTurkishChars("Şişli'de ığdır çok")).encoding).toBe("gsm7");
  });
  it("kalan karakter", () => {
    expect(smsInfo("a".repeat(150)).remainingInSegment).toBe(10);
    expect(smsInfo("").segments).toBe(0);
  });
});
