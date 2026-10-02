import { createHmac } from "node:crypto";

/**
 * Derives a stable, non-public password for one demo identity. The secret is
 * supplied by server-only callers and the resulting password is never shown
 * to the browser or logs. A service-role rotation naturally rotates it.
 */
export function deriveDemoPassword(secret: string, email: string): string {
  const key = secret.trim();
  const identity = email.trim().toLowerCase();
  if (key.length < 32) throw new Error("Demo giriş sırrı en az 32 karakter olmalıdır.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) {
    throw new Error("Demo kimliği geçersiz.");
  }

  const digest = createHmac("sha256", key)
    .update(`emlaksoft-demo-login:v1:${identity}`, "utf8")
    .digest("base64url");
  return `Em!1${digest.slice(0, 40)}`;
}
