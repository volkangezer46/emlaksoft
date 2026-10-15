import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLogLine } from "@/lib/log";
import { errorFields } from "@/lib/log-error";

/**
 * API rotaları (`src/app/api/**`) ham `console.*` yazmaz. Hata nesneleri
 * (PostgREST `details`, sağlayıcı yanıtları) müşteri telefonu/e-postası taşıyabilir;
 * her kayıt `log.*` (PII maskeli, tek satır JSON) + `errorFields(e)` ile yazılır.
 * ESLint `no-console` aynı kuralı editörde yakalar (eslint.config.mjs).
 */

const ROOT = resolve(process.cwd());
const API_DIR = join(ROOT, "src/app/api");

/** Bilinçli istisnalar: dosya → gerekçe. Şu an yok; eklenirse gerekçe zorunlu. */
const ALLOWLIST: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(API_DIR).map((f) => relative(ROOT, f).split("\\").join("/"));

describe("API structured log contract", () => {
  it("finds API source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no raw console.* in src/app/api (use log.* + errorFields)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWLIST[file]) continue;
      const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/\bconsole\s*\.\s*(log|info|warn|error|debug|trace)\s*\(/.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("allowlist entries carry a reason and still exist", () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.trim().length, file).toBeGreaterThan(10);
      expect(files, file).toContain(file);
    }
  });

  it("never passes a raw error object to the logger", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(join(ROOT, file), "utf8");
      // log.error("ev", e) / log.warn("ev", error) gibi alan nesnesi yerine ham değişken
      for (const m of src.matchAll(/\blog\.(info|warn|error)\(\s*"[^"]+"\s*,\s*([A-Za-z_$][\w$.]*)\s*\)/g)) {
        offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("log calls in API routes carry a route field", () => {
    const missing: string[] = [];
    for (const file of files) {
      const src = readFileSync(join(ROOT, file), "utf8");
      for (const m of src.matchAll(/\blog\.(info|warn|error)\(\s*"([^"]+)"\s*(\)|,\s*\{(?![^}]*\broute\s*:))/g)) {
        missing.push(`${file}: ${m[2]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("errorFields", () => {
  it("keeps only code + message from PostgREST-like errors", () => {
    const pg = { code: "23505", message: "duplicate key", details: "Key (phone)=(05321234567) exists", hint: "x" };
    expect(errorFields(pg)).toEqual({ code: "23505", message: "duplicate key" });
  });

  it("handles Error, storage status, strings and nullish values", () => {
    expect(errorFields(new Error("boom"))).toEqual({ code: "Error", message: "boom" });
    expect(errorFields({ statusCode: "404", message: "not found" })).toEqual({ code: "404", message: "not found" });
    expect(errorFields({ status: 500 })).toEqual({ code: "500", message: null });
    expect(errorFields("plain")).toEqual({ code: null, message: "plain" });
    expect(errorFields(null)).toEqual({ code: null, message: null });
    expect(errorFields(undefined)).toEqual({ code: null, message: null });
  });

  it("masks PII that sneaks into the message once written by log", () => {
    const line = buildLogLine("error", "x_failed", {
      route: "/api/x",
      ...errorFields(new Error("musteri ali@ornek.com 05321234567 bulunamadi")),
    });
    expect(line).not.toContain("ali@ornek.com");
    expect(line).not.toContain("05321234567");
    expect(JSON.parse(line)).toMatchObject({ level: "error", event: "x_failed", route: "/api/x" });
  });
});
