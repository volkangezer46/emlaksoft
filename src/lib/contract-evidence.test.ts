import { describe, expect, it } from "vitest";
import {
  cleanUserAgent,
  contractContentSha256,
  formatVerifyCode,
  generateVerifyCode,
  maskPersonName,
  maskPhoneForCertificate,
  normalizeContractText,
  normalizeVerifyCode,
  signerIpHash,
} from "./contract-evidence";

describe("contract content hash", () => {
  it("normalizasyon sabit: CRLF, satır sonu boşlukları ve kenar boşlukları özeti değiştirmez", () => {
    const a = contractContentSha256("Kapora Sözleşmesi", "MADDE 1\nBedel: 100 TL\n");
    const b = contractContentSha256("  Kapora Sözleşmesi ", "\r\nMADDE 1   \r\nBedel: 100 TL\t\r\n\r\n");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tek karakter değişikliği özeti değiştirir; başlık da özete girer", () => {
    const base = contractContentSha256("Sözleşme", "Bedel: 100 TL");
    expect(contractContentSha256("Sözleşme", "Bedel: 101 TL")).not.toBe(base);
    expect(contractContentSha256("Sözleşme 2", "Bedel: 100 TL")).not.toBe(base);
  });

  it("bilinen değer (sürüm kilidi)", () => {
    expect(normalizeContractText("a  \r\nb\r")).toBe("a\nb");
    // Değer değişirse daha önce imzalanmış sözleşmelerin doğrulaması bozulur: sürüm (CONTRACT_HASH_VERSION) artırılmalı.
    expect(contractContentSha256("T", "B")).toBe("a951676b15cb5b8a338b52258202a276f0f1a8033dfc20f0bcc880259df11e4d");
  });
});

describe("verify code", () => {
  it("12 karakter Crockford base32 üretir ve benzersizdir", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateVerifyCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  });

  it("kullanıcı girdisini kanonikleştirir", () => {
    expect(normalizeVerifyCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normalizeVerifyCode("O1IL 2345 6789")).toBe("0111" + "23456789");
    expect(normalizeVerifyCode("kısa")).toBeNull();
    expect(normalizeVerifyCode("ABCDEFGHJKMU")).toBeNull();
    expect(formatVerifyCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
  });
});

describe("signer evidence helpers", () => {
  it("IP özeti sözleşmeye tuzlanır; boş IP null", () => {
    const a = signerIpHash("c1", "1.2.3.4");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(signerIpHash("c2", "1.2.3.4")).not.toBe(a);
    expect(signerIpHash("c1", "")).toBeNull();
  });

  it("user-agent kırpılır ve kontrol karakterleri atılır", () => {
    expect(cleanUserAgent("Mozilla\n/5.0")).toBe("Mozilla /5.0");
    expect(cleanUserAgent("x".repeat(500))?.length).toBe(400);
    expect(cleanUserAgent(null)).toBeNull();
  });

  it("ad ve telefon maskesi kişisel veri sızdırmaz", () => {
    expect(maskPersonName("Ahmet Yılmaz")).toBe("A*** Y***");
    expect(maskPersonName("")).toBe("İmzacı");
    expect(maskPhoneForCertificate("05321234567")).toBe("0532 *** ** 67");
    expect(maskPhoneForCertificate(null)).toBeNull();
  });
});
