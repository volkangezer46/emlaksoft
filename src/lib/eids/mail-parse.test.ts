import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractAddress, parseMime } from "./mime";
import {
  extractForwardConfirmation,
  forwardProviderOf,
  mailBodyToNormalizedText,
  maskGrantorName,
  maskSample,
  normalizePersonName,
  parseEidsText,
  parseTrDate,
} from "./mail-parse";
import { aarShowsEidsSpfPass, classifyMailAuth } from "./mail-auth";
import { verifyEmlAuth } from "./dkim";

/**
 * Fikstürler (`fixtures/eids-mail.fixture.json`): tasarım belgesindeki EİDS metin kalıbıyla KURULMUŞ iki örnek
 * (verme: DKIM imzalı; iptal: DKIM'siz, Gmail ARC mühürlü) + taklit ve bozulmuş türevleri. İmza ve mühürler
 * bağımsız bir uygulamayla (mailauth 5.0.3) üretildi; böylece `dkim.ts` doğrulayıcısı çapraz denetlenir.
 * Gerçek Bakanlık .eml'i geldiğinde (sahip girdisi) aynı testler onunla da koşturulmalı.
 */
const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "eids-mail.fixture.json"), "utf8")) as Record<string, string> & {
  keys: { ticaret: string; google: string };
};

const resolver = async (name: string): Promise<string[][]> => {
  if (name === "eids2026._domainkey.ticaret.gov.tr") return [[`v=DKIM1; k=rsa; p=${fx.keys.ticaret}`]];
  if (name === "arc-20240605._domainkey.google.com") return [[`v=DKIM1; k=rsa; p=${fx.keys.google}`]];
  throw Object.assign(new Error("NXDOMAIN"), { code: "ENOTFOUND" });
};

function bodyOf(raw: string) {
  const m = parseMime(raw);
  return { mime: m, text: mailBodyToNormalizedText({ html: m.html, text: m.text }) };
}

describe("EİDS e-posta ayrıştırıcı: örnek e-postalar", () => {
  it("verme e-postası: no, satış, ad, tarih", () => {
    const { mime, text } = bodyOf(fx.grantSigned);
    expect(extractAddress(mime.get("from"))).toBe("eids.yetki@ticaret.gov.tr");
    expect(mime.get("subject")).toContain("Taşınmaz Yetkilendirme");
    expect(mime.get("message-id")).toBe("<eids-grant-0001@ticaret.gov.tr>");
    expect(parseEidsText(text)).toEqual({
      kind: "grant",
      propertyNo: "1234567890",
      dealKind: "sale",
      grantorName: "AHMET YILMAZ",
      validUntil: "2027-03-31",
    });
    // Yasal uyarı ve otomatik gönderim notu özet metinden atılır.
    expect(text).not.toMatch(/YASAL UYARI|otomatik olarak/i);
  });

  it("iptal e-postası: no, kira, ad", () => {
    const { text } = bodyOf(fx.revokeArc);
    expect(parseEidsText(text)).toEqual({
      kind: "revoke",
      propertyNo: "9876543210",
      dealKind: "rent",
      grantorName: "AYŞE DEMİR",
      validUntil: null,
    });
  });

  it("düz metin (yapıştırma) da aynı sonucu verir; boşluk/satır sonu farkı önemsiz", () => {
    const pasted = "Sayın Ofis,\n\n1234567890   taşınmaz numaralı taşınmazın\nsatışına ilişkin ilan verilmesi konusunda Ahmet Yılmaz tarafından 31.03.2027 tarihine kadar yetkilendirildiniz.";
    const p = parseEidsText(mailBodyToNormalizedText({ text: pasted }));
    expect(p).toMatchObject({ kind: "grant", propertyNo: "1234567890", grantorName: "Ahmet Yılmaz", validUntil: "2027-03-31" });
  });

  it("kalıba uymayan metin unknown (unknown_format)", () => {
    expect(parseEidsText("Merhaba, toplantı yarın saat 10'da.")).toEqual({ kind: "unknown", reason: "no_pattern" });
    expect(parseEidsText("")).toEqual({ kind: "unknown", reason: "empty" });
    // Şablon değişmiş: tarih biçimi farklı.
    expect(
      parseEidsText("1234567890 taşınmaz numaralı taşınmazın satışına ilişkin ilan konusunda Ali Veli tarafından 2027-03-31 tarihine kadar yetkilendirildiniz"),
    ).toEqual({ kind: "unknown", reason: "no_pattern" });
    // Geçersiz tarih (31 Şubat) kabul edilmez.
    expect(
      parseEidsText("1234567890 taşınmaz numaralı taşınmazın satışına ilişkin ilan konusunda Ali Veli tarafından 31.02.2027 tarihine kadar yetkilendirildiniz"),
    ).toEqual({ kind: "unknown", reason: "bad_date" });
    // Kısa numara (5 hane) kalıba uymaz.
    expect(parseEidsText("12345 taşınmaz numaralı taşınmazın satışına ilişkin x konusunda Ali tarafından 01.01.2027 tarihine kadar yetkilendirildiniz").kind).toBe("unknown");
  });

  it("bozuk MIME fırlatmaz", () => {
    const m = parseMime("Content-Type: multipart/mixed; boundary=zz\r\n\r\n--zz\r\nContent-Transfer-Encoding: base64\r\n\r\n@@@@");
    expect(m.text === null || typeof m.text === "string").toBe(true);
    expect(parseMime("").headers).toEqual([]);
  });

  it("tarih ayrıştırma ve ad maskesi / normalleştirme", () => {
    expect(parseTrDate("29.02.2028")).toBe("2028-02-29");
    expect(parseTrDate("29.02.2027")).toBeNull();
    expect(maskGrantorName("Ahmet Yılmaz")).toBe("Ah*** Yı****");
    expect(maskGrantorName("AYŞE DEMİR")).toBe("AY** DE***");
    expect(normalizePersonName("Demir Ayşe")).toBe("ayse demir");
    expect(normalizePersonName("AYŞE  DEMİR")).toBe("ayse demir");
    expect(normalizePersonName("Ayşe Demir")).toBe(normalizePersonName("AYŞE DEMİR"));
    const sample = maskSample("Sayın Ofis, 1234567890 numaralı Ahmet Yılmaz x@y.com https://a.b/c");
    expect(sample).not.toMatch(/\d|Ahmet|x@y\.com|https/);
  });
});

describe("iletme onay e-postaları", () => {
  it("Gmail onay kodu ve bağlantısı çıkarılır", () => {
    expect(forwardProviderOf("forwarding-noreply@google.com")?.provider).toBe("gmail");
    expect(forwardProviderOf("eids.yetki@ticaret.gov.tr")).toBeNull();
    // Herkesin açabileceği sağlayıcı adresleri iletme onayı sayılmaz (gönderen kapısı delinmesin).
    expect(forwardProviderOf("saldirgan@outlook.com")).toBeNull();
    expect(forwardProviderOf("ali.noreply@yandex.ru")).toBeNull();
    expect(forwardProviderOf("account-security-noreply@accountprotection.microsoft.com")?.provider).toBe("outlook");
    expect(forwardProviderOf("noreply@yandex.ru")?.provider).toBe("yandex");
    const c = extractForwardConfirmation(
      "gmail",
      "(#123456789) Gmail Yönlendirme Onayı - ofis@gmail.com adresinden posta al",
      "Onaylamak için tıklayın: https://mail-settings.google.com/mail/vf-%5BANGjdJ8x%5D-abc Onay kodu: 123456789",
    );
    expect(c).toEqual({ provider: "gmail", code: "123456789", url: "https://mail-settings.google.com/mail/vf-%5BANGjdJ8x%5D-abc" });
  });

  it("başka alan adına giden bağlantı alınmaz (kimlik avı)", () => {
    const c = extractForwardConfirmation("gmail", "(#111222333) onay", "https://evil.example/mail/vf-x https://mail-settings.google.com.evil.tr/mail/vf-y");
    expect(c.url).toBeNull();
    expect(c.code).toBe("111222333");
  });
});

describe("kaynak doğrulama: DKIM/ARC (mailauth ile üretilmiş fikstürlerle çapraz)", () => {
  it("DKIM d=ticaret.gov.tr geçerli → verified (relaxed ve simple)", async () => {
    for (const raw of [fx.grantSigned, fx.grantSignedSimple]) {
      const ev = await verifyEmlAuth(raw, resolver);
      expect(ev.dkim).toEqual([{ domain: "ticaret.gov.tr", result: "pass" }]);
      expect(classifyMailAuth(ev, { direct: false }).result).toBe("verified");
    }
  });

  it("LF satır sonlu .eml (indirilmiş dosya) da doğrulanır", async () => {
    const ev = await verifyEmlAuth(fx.grantSigned.replace(/\r\n/g, "\n"), resolver);
    expect(ev.dkim[0]?.result).toBe("pass");
  });

  it("gövdesi değiştirilmiş DKIM'li e-posta doğrulanmaz", async () => {
    const ev = await verifyEmlAuth(fx.tampered, resolver);
    expect(ev.dkim[0]?.result).not.toBe("pass");
    expect(classifyMailAuth(ev, { direct: false }).result).toBe("unverified");
  });

  it("Gmail ARC mührü + spf=pass smtp.mailfrom=ticaret.gov.tr → verified_via_arc", async () => {
    const ev = await verifyEmlAuth(fx.revokeArc, resolver);
    expect(ev.arc?.result).toBe("pass");
    expect(ev.arc?.sets[0]?.sealer).toBe("google.com");
    expect(classifyMailAuth(ev, { direct: false })).toMatchObject({ result: "verified_via_arc" });
  });

  it("ARC geçerli ama SPF fail → unverified; mühürden sonra değiştirilmiş → arc fail", async () => {
    const ev = await verifyEmlAuth(fx.revokeArcSpfFail, resolver);
    expect(ev.arc?.result).toBe("pass");
    expect(classifyMailAuth(ev, { direct: false }).result).toBe("unverified");
    const t = await verifyEmlAuth(fx.arcTampered, resolver);
    expect(t.arc?.result).toBe("fail");
    expect(classifyMailAuth(t, { direct: false }).result).toBe("unverified");
  });

  it("güvenilir i=1 kümesi + yabancı i=2 ile gövdesi değiştirilmiş e-posta → unverified (ARC sahteciliği)", async () => {
    // Saldırgan Gmail'in gerçek i=1 kümesini korur, gövdeyi kendi verme metniyle değiştirir ve kendi anahtarıyla
    // i=2 ekler: zincir kriptografik olarak geçer ama son AMS'i güvenilmeyen alan imzaladığından doğrulanmış sayılmaz.
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const r2 = async (name: string): Promise<string[][]> =>
      name === "s1._domainkey.attacker.example" ? [[`v=DKIM1; k=rsa; p=${pub}`]] : resolver(name);
    const raw = fx.revokeArc;
    const headerBlock = raw.slice(0, raw.indexOf("\r\n\r\n") + 2);
    const body =
      "<html><body><div>5555555555 ta=C5=9F=C4=B1nmaz numaral=C4=B1 ta=C5=9F=C4=B1nmaz=C4=B1n sat=C4=B1=C5=9F=C4=B1na ili=C5=9Fkin ilan verilmesi konusunda SAHTE MALIK taraf=C4=B1ndan 31.12.2030 tarihine kadar yetkilendirildiniz.</div></body></html>\r\n";
    const relaxed = (name: string, value: string) => `${name.toLowerCase()}:${value.replace(/\r\n/g, "").replace(/[ \t]+/g, " ").trim()}\r\n`;
    const hs: { name: string; value: string }[] = [];
    for (const l of headerBlock.split("\r\n")) {
      if (!l) continue;
      if (/^[ \t]/.test(l)) hs[hs.length - 1]!.value += `\r\n${l}`;
      else hs.push({ name: l.slice(0, l.indexOf(":")), value: l.slice(l.indexOf(":") + 1) });
    }
    const get = (n: string) => hs.filter((h) => h.name.toLowerCase() === n);
    const bh = createHash("sha256").update(body.replace(/(\r\n)*$/, "") + "\r\n", "latin1").digest("base64");
    const hlist = ["from", "to", "subject", "date", "message-id"];
    const amsVal0 = ` i=2; a=rsa-sha256; c=relaxed/relaxed; d=attacker.example; s=s1; h=${hlist.join(":")}; bh=${bh}; b=`;
    const amsData = hlist.map((n) => relaxed(n, get(n).at(-1)!.value)).join("") + relaxed("ARC-Message-Signature", amsVal0).replace(/\r\n$/, "");
    const amsVal = amsVal0 + sign("sha256", Buffer.from(amsData, "latin1"), privateKey).toString("base64");
    const aar2 = " i=2; mx.attacker.example; arc=pass";
    const asVal0 = " i=2; a=rsa-sha256; cv=pass; d=attacker.example; s=s1; b=";
    const asData =
      relaxed("ARC-Authentication-Results", get("arc-authentication-results")[0]!.value) +
      relaxed("ARC-Message-Signature", get("arc-message-signature")[0]!.value) +
      relaxed("ARC-Seal", get("arc-seal")[0]!.value) +
      relaxed("ARC-Authentication-Results", aar2) +
      relaxed("ARC-Message-Signature", amsVal) +
      relaxed("ARC-Seal", asVal0).replace(/\r\n$/, "");
    const asVal = asVal0 + sign("sha256", Buffer.from(asData, "latin1"), privateKey).toString("base64");
    const forged = `ARC-Seal:${asVal}\r\nARC-Message-Signature:${amsVal}\r\nARC-Authentication-Results:${aar2}\r\n${headerBlock}\r\n${body}`;
    const ev = await verifyEmlAuth(forged, r2);
    expect(ev.arc?.result).toBe("pass");
    expect(ev.arc?.sets.map((x) => x.sealer)).toEqual(["google.com", "attacker.example"]);
    expect(classifyMailAuth(ev, { direct: false }).result).toBe("unverified");
  });

  it("ARC kuralı: güvenilir kümeden sonraki bütün mühürleyiciler güvenilir olmalı", () => {
    const spf = "mx.google.com; spf=pass (designates 95.0.51.137 as permitted sender) smtp.mailfrom=eids.yetki@ticaret.gov.tr";
    const chain = (...sealers: string[]) => ({
      dkim: [],
      arc: { result: "pass", sets: sealers.map((sealer, k) => ({ i: k + 1, sealer, aar: k === 0 ? spf : "x; arc=pass" })) },
      spf: null,
      dmarc: null,
    });
    expect(classifyMailAuth(chain("google.com"), { direct: false }).result).toBe("verified_via_arc");
    expect(classifyMailAuth(chain("google.com", "outlook.com"), { direct: false }).result).toBe("verified_via_arc");
    expect(classifyMailAuth(chain("google.com", "evil.example"), { direct: false }).result).toBe("unverified");
    expect(classifyMailAuth(chain("google.com", "evil.example", "google.com"), { direct: false }).result).toBe("unverified");
  });

  it("taklit From (DKIM/ARC yok, SPF fail) → unverified", async () => {
    const ev = await verifyEmlAuth(fx.spoof, resolver);
    expect(ev.dkim).toEqual([]);
    expect(ev.arc).toBeNull();
    const smtp = { ...ev, spf: { result: "fail", domain: "ticaret.gov.tr" }, dmarc: { result: "fail" } };
    expect(classifyMailAuth(smtp, { direct: true }).result).toBe("unverified");
    // Doğrudan teslimde SPF + DMARC pass → verified (kural 3); iletilmiş sayılırsa SPF tek başına yetmez.
    const direct = { ...ev, spf: { result: "pass", domain: "ticaret.gov.tr" }, dmarc: { result: "pass" } };
    expect(classifyMailAuth(direct, { direct: true }).result).toBe("verified");
    expect(classifyMailAuth(direct, { direct: false }).result).toBe("unverified");
  });

  it("AAR'da izinsiz IP veya başka alan adı → ARC yolu kapalı", () => {
    expect(aarShowsEidsSpfPass("mx.google.com; spf=pass (designates 95.0.51.141 as permitted sender) smtp.mailfrom=eids.yetki@ticaret.gov.tr")).toBe(true);
    expect(aarShowsEidsSpfPass("mx.google.com; spf=pass (designates 1.2.3.4 as permitted sender) smtp.mailfrom=eids.yetki@ticaret.gov.tr")).toBe(false);
    expect(aarShowsEidsSpfPass("mx.google.com; spf=pass smtp.mailfrom=x@ticaret.gov.tr.evil.com")).toBe(false);
    expect(aarShowsEidsSpfPass("mx.google.com; spf=softfail smtp.mailfrom=eids.yetki@ticaret.gov.tr")).toBe(false);
    // Güvenilmeyen mühürleyici: zincir geçerli olsa da sayılmaz.
    const ev = { dkim: [], arc: { result: "pass", sets: [{ i: 1, sealer: "evil.example", aar: "x; spf=pass smtp.mailfrom=eids.yetki@ticaret.gov.tr" }] }, spf: null, dmarc: null };
    expect(classifyMailAuth(ev, { direct: false }).result).toBe("unverified");
  });
});
