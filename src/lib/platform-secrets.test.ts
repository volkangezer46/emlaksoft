import { afterEach, describe, expect, it, vi } from "vitest";
import {
  derivePlatformHmac,
  openPlatformSecret,
  platformSecretsEnabled,
  sealPlatformSecret,
} from "./platform-secrets";
import { FAKE_KEY, FAKE_SECRETS_KEY, FAKE_SECRETS_KEY_OTHER } from "@/lib/integrations/emlakfiyati/test-fixtures";

afterEach(() => vi.unstubAllEnvs());

describe("platform-secrets (AES-256-GCM, PLATFORM_SECRETS_KEY)", () => {
  it("anahtar tanımlı değilse etkin değil: şifrelemez, çözmez", () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", "");
    expect(platformSecretsEnabled()).toBe(false);
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
