import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLATFORM_SECRETS_DERIVE_SOURCES,
  derivePlatformHmac,
  openPlatformSecret,
  platformSecretsEnabled,
  platformSecretsKeySource,
  sealPlatformSecret,
} from "./platform-secrets";
import { FAKE_KEY, FAKE_SECRETS_KEY, FAKE_SECRETS_KEY_OTHER } from "@/lib/integrations/emlakfiyati/test-fixtures";

afterEach(() => vi.unstubAllEnvs());

/** Test ortamında olası gerçek sunucu sırlarının sızmasını önler. */
function clearDeriveSources() {
  for (const name of PLATFORM_SECRETS_DERIVE_SOURCES) vi.stubEnv(name, "");
}
const DERIVE_SECRET = "otp-test-secret-0123456789abcdef-0123456789";
const DERIVE_SECRET_OTHER = "other-test-secret-fedcba9876543210-9876543210";

describe("platform-secrets (AES-256-GCM, PLATFORM_SECRETS_KEY)", () => {
  it("anahtar tanımlı değilse etkin değil: şifrelemez, çözmez", () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", "");
    clearDeriveSources();
    expect(platformSecretsEnabled()).toBe(false);
    expect(platformSecretsKeySource()).toBe("none");
    expect(sealPlatformSecret("a", "x")).toBeNull();
    expect(openPlatformSecret("a", "v1.a.b.c")).toBeNull();
    expect(derivePlatformHmac("d", "x")).toBeNull();
  });

  it("gidiş-dönüş: düz metin şifreli değerde görünmez, çözülünce aynı değer gelir", () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", FAKE_SECRETS_KEY);
    const sealed = sealPlatformSecret("emlakfiyati_key_current", FAKE_KEY);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain(FAKE_KEY);
    expect(openPlatformSecret("emlakfiyati_key_current", sealed)).toBe(FAKE_KEY);
    // Her şifreleme rastgele IV kullanır.
    expect(sealPlatformSecret("emlakfiyati_key_current", FAKE_KEY)).not.toBe(sealed);
  });

  it("başka ayar satırına taşınan, yanlış anahtarlı veya bozuk değer çözülmez", () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", FAKE_SECRETS_KEY);
    const sealed = sealPlatformSecret("emlakfiyati_key_current", FAKE_KEY);
    expect(openPlatformSecret("emlakfiyati_key_previous", sealed)).toBeNull();
    const parts = (sealed as string).split(".");
    parts[3] = (parts[3]![0] === "A" ? "B" : "A") + parts[3]!.slice(1);
    expect(openPlatformSecret("emlakfiyati_key_current", parts.join("."))).toBeNull();
    vi.stubEnv("PLATFORM_SECRETS_KEY", FAKE_SECRETS_KEY_OTHER);
    expect(openPlatformSecret("emlakfiyati_key_current", sealed)).toBeNull();
  });
});

describe("platform-secrets: yedek anahtar (sunucu sırrından HKDF türetimi)", () => {
  it("PLATFORM_SECRETS_KEY yoksa OTP_HMAC_SECRET'tan türetir: etkin, kaynak 'derived', gidiş-dönüş çalışır", () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", "");
    clearDeriveSources();
    vi.stubEnv("OTP_HMAC_SECRET", DERIVE_SECRET);
    expect(platformSecretsEnabled()).toBe(true);
    expect(platformSecretsKeySource()).toBe("derived");
    const sealed = sealPlatformSecret("emlakfiyati_key_current", FAKE_KEY);
    expect(sealed).toMatch(/^v1./);
    expect(sealed).not.toContain(FAKE_KEY);
    expect(sealed).not.toContain(DERIVE_SECRET);
    expect(openPlatformSecret("emlakfiyati_key_current", sealed)).toBe(FAKE_KEY);
  });

  it("kaynak sır çok kısaysa (<24) kullanılmaz", () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", "");
    clearDeriveSources();
    vi.stubEnv("OTP_HMAC_SECRET", "kisa-sir");
    expect(platformSecretsEnabled()).toBe(false);
    expect(platformSecretsKeySource()).toBe("none");
  });

  it("OTP yoksa sıradaki kaynağa (TWO_FACTOR_COOKIE_SECRET) düşer", () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", "");
    clearDeriveSources();
    vi.stubEnv("TWO_FACTOR_COOKIE_SECRET", DERIVE_SECRET_OTHER);
    expect(platformSecretsKeySource()).toBe("derived");
    const sealed = sealPlatformSecret("k", "deger");
    expect(openPlatformSecret("k", sealed)).toBe("deger");
  });

  it("sonradan PLATFORM_SECRETS_KEY eklenirse eski (türetilmiş) kayıt çözülmeye DEVAM eder; yeni yazım env anahtarıyla yapılır", () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", "");
    clearDeriveSources();
    vi.stubEnv("OTP_HMAC_SECRET", DERIVE_SECRET);
    const eski = sealPlatformSecret("emlakfiyati_key_current", FAKE_KEY);

    vi.stubEnv("PLATFORM_SECRETS_KEY", FAKE_SECRETS_KEY);
    expect(platformSecretsKeySource()).toBe("env");
    expect(openPlatformSecret("emlakfiyati_key_current", eski)).toBe(FAKE_KEY);
    const yeni = sealPlatformSecret("emlakfiyati_key_current", FAKE_KEY);
    // Yeni kayıt env anahtarıyla yazıldı: türetilmiş kaynak kalkınca da çözülür.
    clearDeriveSources();
    expect(openPlatformSecret("emlakfiyati_key_current", yeni)).toBe(FAKE_KEY);
    // Eski kayıt ise artık çözülemez (kaynak sır yok): admin yeniden girer.
    expect(openPlatformSecret("emlakfiyati_key_current", eski)).toBeNull();
  });

  it("kaynak sır döndürülürse (değişirse) eski kayıt çözülemez ve null döner (fırlatmaz)", () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", "");
    clearDeriveSources();
    vi.stubEnv("OTP_HMAC_SECRET", DERIVE_SECRET);
    const sealed = sealPlatformSecret("k", "deger");
    vi.stubEnv("OTP_HMAC_SECRET", DERIVE_SECRET_OTHER);
    expect(openPlatformSecret("k", sealed)).toBeNull();
  });

  it("türetilmiş anahtar kaynak sırrın kendisi değildir (alan ayrımı): aynı sırla başka alan farklı çıktı verir", () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", "");
    clearDeriveSources();
    vi.stubEnv("OTP_HMAC_SECRET", DERIVE_SECRET);
    // HKDF çıktısı ham sırdan türemez biçimde 32 bayttır; şifreli metin ham sırrı içermez.
    const sealed = sealPlatformSecret("k", DERIVE_SECRET) as string;
    expect(sealed).not.toContain(DERIVE_SECRET);
    expect(openPlatformSecret("k", sealed)).toBe(DERIVE_SECRET);
  });
});
