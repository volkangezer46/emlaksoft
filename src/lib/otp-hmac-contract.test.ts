import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("OTP storage integration contract", () => {
  it("routes every login and signature OTP through the single server HMAC helper", () => {
    const auth = read("src/app/actions/auth.ts");
    const loginVerify = read("src/app/giris/dogrulama/actions.ts");
    const contracts = read("src/app/actions/contracts.ts");
    const twoFactor = read("src/lib/two-factor.ts");

    expect(auth).toContain('hashOtpForStorage(code, "login", userId)');
    expect(loginVerify).toContain('verifyOtpHash(code, challenge.code_hash, "login", user.id)');
    expect(loginVerify).toContain('hashOtpForStorage(code, "login", user.id)');
    expect(contracts).toContain(
      'hashOtpForStorage(code, "contract-signature", signer.id)',
    );
    expect(contracts).toContain(
      'verifyOtpHash(code, signer.otp_hash, "contract-signature", signer.id)',
    );
    expect(contracts.match(/\.eq\("otp_attempts", attempts\)/g)).toHaveLength(2);
    expect(contracts.match(/\.eq\("otp_hash", signer\.otp_hash\)/g)).toHaveLength(2);
    expect(contracts.match(/\.eq\("otp_expires_at", signer\.otp_expires_at\)/g)).toHaveLength(2);
    expect(contracts.match(/\.select\("id"\)\s*\n\s*\.maybeSingle\(\)/g)).toHaveLength(2);
    expect(auth + loginVerify + contracts + twoFactor).not.toContain('createHash("sha256")');
    expect(twoFactor).not.toContain("sha256Hex");
  });

  it("documents an independent non-public pepper without ever logging its value", () => {
    const helper = read("src/lib/otp-hmac.ts");
    const example = read(".env.example");
    const consumers = [
      read("src/app/actions/auth.ts"),
      read("src/app/giris/dogrulama/actions.ts"),
      read("src/app/actions/contracts.ts"),
    ].join("\n");

    expect(helper).toContain('import { createHash, createHmac, timingSafeEqual } from "node:crypto"');
    expect(helper).toContain("hmac-sha256-v1");
    expect(example).toContain("OTP_HMAC_SECRET=");
    expect(consumers).not.toContain("process.env.OTP_HMAC_SECRET");
  });
});
