import "server-only";

import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { guardedLookup, ForbiddenTargetError, isForbiddenIp, type Resolver } from "@/lib/integrations-api/safe-delivery";

/**
 * İçe aktarılan portföyün fotoğraf bağlantısını SSRF korumalı indirir (yalnız sunucu).
 *
 * Kurallar (webhook teslimiyle aynı çekirdek: `guardedLookup` bağlantının kendisini denetler, DNS rebinding yok):
 *  - yalnız https + 443, kullanıcı/parola yok, IP literal yok, alan adı noktalı;
 *  - en çok 3 yönlendirme, her adımda aynı denetim (https dışına / iç ağa yönlendirme reddedilir);
 *  - gövde akışla okunur, `maxBytes` aşılınca bağlantı kesilir; zaman aşımı istek başına;
 *  - tür, `Content-Type` başlığına DEĞİL baytların imzasına göre belirlenir (jpeg/png/webp/gif).
 * Son doğrulama yine yükleme hattında (finalizeDirectFileUpload) baytlar üzerinden yapılır.
 */

export type FetchedImage = { ok: true; bytes: Buffer; mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; ext: string };
export type FetchImageResult = FetchedImage | { ok: false; error: string };

const MAX_REDIRECTS = 3;

export function photoUrlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Geçersiz bağlantı";
  }
  if (u.protocol !== "https:") return "Yalnız https bağlantıları indirilir";
  if (u.username || u.password) return "Bağlantıda kullanıcı adı/parola olamaz";
  if (u.port && u.port !== "443") return "Standart dışı port";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) return "IP adresli bağlantı kabul edilmez";
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") return "İç ağ adresi kabul edilmez";
  return null;
}

/** Bayt imzasından görsel türü (bilinmiyorsa null). */
export function sniffImageMime(b: Uint8Array): FetchedImage["mime"] | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  return null;
}

const EXT: Record<FetchedImage["mime"], string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

type Hop = { status: number; location: string | null; body: Buffer | null; error: string | null };

function oneRequest(url: URL, opts: { maxBytes: number; timeoutMs: number; resolver?: Resolver }): Promise<Hop> {
  return new Promise<Hop>((resolve) => {
    let settled = false;
    const done = (h: Hop) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(h);
    };
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isForbiddenIp(host)) return done({ status: 0, location: null, body: null, error: "İç ağ adresi reddedildi" });
    const req = httpsRequest(
      {
        protocol: "https:",
        hostname: host,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { Accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8", "User-Agent": "EmlakSoft-Import/1.0" },
        agent: false,
        lookup: guardedLookup(opts.resolver) as never,
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          res.destroy();
          return done({ status, location: typeof res.headers.location === "string" ? res.headers.location : null, body: null, error: null });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          res.destroy();
          return done({ status, location: null, body: null, error: `HTTP ${status}` });
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > opts.maxBytes) {
          res.destroy();
          return done({ status, location: null, body: null, error: "Dosya çok büyük" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            res.destroy();
            done({ status, location: null, body: null, error: "Dosya çok büyük" });
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => done({ status, location: null, body: Buffer.concat(chunks), error: null }));
        res.on("error", () => done({ status, location: null, body: null, error: "Bağlantı hatası" }));
      },
    );
    const timer = setTimeout(() => {
      req.destroy(new Error("timeout"));
      done({ status: 0, location: null, body: null, error: "Zaman aşımı" });
    }, opts.timeoutMs);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
      done({ status: 0, location: null, body: null, error: "Zaman aşımı" });
    });
    req.on("error", (e) => {
      const forbidden = e instanceof ForbiddenTargetError || (e as Error).name === "ForbiddenTargetError";
      done({ status: 0, location: null, body: null, error: forbidden ? "İç ağ adresi reddedildi" : "Bağlantı hatası" });
    });
    req.end();
  });
}

export async function fetchImportPhoto(
  rawUrl: string,
  opts: { maxBytes: number; timeoutMs?: number; resolver?: Resolver },
): Promise<FetchImageResult> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = photoUrlProblem(current);
    if (problem) return { ok: false, error: problem };
    const res = await oneRequest(new URL(current), { maxBytes: opts.maxBytes, timeoutMs: opts.timeoutMs ?? 15_000, resolver: opts.resolver });
    if (res.error) return { ok: false, error: res.error };
    if (res.location) {
      try {
        current = new URL(res.location, current).toString();
      } catch {
        return { ok: false, error: "Geçersiz yönlendirme" };
      }
      continue;
    }
    if (!res.body || res.body.length === 0) return { ok: false, error: "Boş dosya" };
    const mime = sniffImageMime(res.body);
    if (!mime) return { ok: false, error: "Görsel değil (jpeg/png/webp bekleniyor)" };
    return { ok: true, bytes: res.body, mime, ext: EXT[mime] };
  }
  return { ok: false, error: "Çok fazla yönlendirme" };
}
