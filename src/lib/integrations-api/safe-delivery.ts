/**
 * Giden webhook için SSRF / DNS yeniden bağlama (rebinding) korumalı HTTPS POST (yalnız sunucu; node:https + node:dns).
 *
 * Neden `fetch` değil: `fetch` adı kendisi çözer; kayıt anında yapılan ad denetimi (validateWebhookUrl) ile teslim anı
 * arasında DNS yanıtı değişirse (rebinding) istek iç ağa gidebilir. Burada bağlantının KENDİSİ `lookup` kancasından
 * geçer: çözülen HER adres denetlenir, yasak aralıktaki tek bir adres bile isteği reddeder ve soket yalnız denetlenen
 * adrese açılır (aynı çözüm sonucu kullanılır; ikinci bir çözüm yok). Ek kurallar:
 *  - yalnız https + 443, kullanıcı/parola yok (validateWebhookUrl yeniden uygulanır),
 *  - yönlendirme TAKİP EDİLMEZ (node:https izlemez; 3xx başarısız sayılır),
 *  - sabit zaman aşımı (bağlantı + yanıt), bağlantı havuzu yok (`agent: false`: başka isteğin soketi yeniden kullanılmaz),
 *  - yanıt gövdesi okunmaz (yalnız durum kodu).
 */
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { validateWebhookUrl } from "@/lib/integrations-api/core";

/** IPv4 → 32 bit tam sayı (geçersizse null). */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** [ağ, önek uzunluğu] — özel, yerel, link-local, paylaşılan (CGNAT), bulut metadata, belgeleme, çoklu yayın, ayrılmış. */
const FORBIDDEN_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local + 169.254.169.254 bulut metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function inV4Range(n: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base)!;
  const size = 2 ** (32 - bits);
  return Math.floor(n / size) === Math.floor(b / size);
}

export function isForbiddenIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // tanınmayan biçim = reddet (fail-closed)
  return FORBIDDEN_V4.some(([base, bits]) => inV4Range(n, base, bits));
}

/** IPv6 → 8 adet 16 bit grup (gömülü IPv4 sonekini de çözer); geçersizse null. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const n = ipv4ToInt(maybeV4);
    if (n === null) return null;
    tail = [Math.floor(n / 65536), n % 65536];
    s = s.slice(0, lastColon + 1) + "0:0";
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (h: string) => (h === "" ? [] : h.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some((g) => Number.isNaN(g))) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail.length === 2) {
    groups[6] = tail[0];
    groups[7] = tail[1];
  }
  return groups;
}

function v4FromGroups(hi: number, lo: number): string {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

export function isForbiddenIpv6(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return true;
  const allZeroTo = (i: number) => g.slice(0, i).every((x) => x === 0);
  if (g.every((x) => x === 0)) return true; // ::
  if (allZeroTo(7) && g[7] === 1) return true; // ::1
  if (allZeroTo(5) && g[5] === 0xffff) return isForbiddenIpv4(v4FromGroups(g[6], g[7])); // ::ffff:a.b.c.d
  if (allZeroTo(6)) return true; // ::a.b.c.d (kullanımdan kalkmış, IPv4 uyumlu)
  if (g[0] === 0x64 && g[1] === 0xff9b) return isForbiddenIpv4(v4FromGroups(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isForbiddenIpv4(v4FromGroups(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 benzersiz yerel
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (eski)
  if ((g[0] & 0xff00) === 0xff00) return true; // çoklu yayın
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // belgeleme
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 atma
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32
  return false;
}

/** Teslim hedefi olamayacak adres mi? (IPv4/IPv6; tanınmayan biçim = evet) */
export function isForbiddenIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isForbiddenIpv4(ip);
  if (v === 6) return isForbiddenIpv6(ip);
  return true;
}

export class ForbiddenTargetError extends Error {
  constructor() {
    super("Webhook hedefi iç ağ / ayrılmış bir adrese çözülüyor.");
    this.name = "ForbiddenTargetError";
  }
}

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
  });

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * `net.connect` uyumlu lookup kancası: tüm adresleri çözer, BİRİ bile yasaksa reddeder (karışık yanıtla atlatma yok),
 * aksi halde bağlantıyı yalnız denetlenen adrese yönlendirir.
 */
export function guardedLookup(resolver: Resolver = systemResolver) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback): void => {
    resolver(hostname)
      .then((addresses) => {
        if (addresses.length === 0 || addresses.some((a) => isForbiddenIp(a.address))) {
          callback(new ForbiddenTargetError() as NodeJS.ErrnoException, "", 0);
          return;
        }
        if (typeof options === "object" && options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      })
      .catch((e: NodeJS.ErrnoException) => callback(e, "", 0));
  };
}

export type SafePostResult = { ok: boolean; status: number | null; error: string | null };

/**
 * SSRF korumalı HTTPS POST. Asla fırlatmaz; sonuç `{ok, status, error}` (hata metni kullanıcıya gösterilebilir, gövde yok).
 */
export function safeWebhookPost(
  rawUrl: string,
  headers: Record<string, string>,
  body: string,
  opts: { timeoutMs: number; resolver?: Resolver },
): Promise<SafePostResult> {
  const v = validateWebhookUrl(rawUrl);
  if (!v.ok) return Promise.resolve({ ok: false, status: null, error: "Geçersiz hedef adresi" });
  const url = new URL(v.url);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // IP literal'de lookup çağrılmaz: doğrudan denetle (validateWebhookUrl zaten reddeder; derinlemesine savunma).
  if (isIP(host) && isForbiddenIp(host)) return Promise.resolve({ ok: false, status: null, error: "İç ağ adresi reddedildi" });

  return new Promise<SafePostResult>((resolve) => {
    let settled = false;
    const done = (r: SafePostResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const req = httpsRequest(
      {
        protocol: "https:",
        hostname: host,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
        agent: false,
        lookup: guardedLookup(opts.resolver) as never,
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? null;
        res.resume(); // gövde okunmaz, soket boşaltılır
        res.destroy();
        if (status !== null && status >= 300 && status < 400) {
          done({ ok: false, status, error: "Yönlendirme reddedildi" });
          return;
        }
        const ok = status !== null && status >= 200 && status < 300;
        done({ ok, status, error: ok ? null : `HTTP ${status ?? "?"}` });
      },
    );
    const timer = setTimeout(() => {
      req.destroy(new Error("timeout"));
      done({ ok: false, status: null, error: "Zaman aşımı" });
    }, opts.timeoutMs);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
      done({ ok: false, status: null, error: "Zaman aşımı" });
    });
    req.on("error", (e) => {
      if (e instanceof ForbiddenTargetError || (e as Error).name === "ForbiddenTargetError") {
        done({ ok: false, status: null, error: "İç ağ adresi reddedildi" });
      } else {
        done({ ok: false, status: null, error: "Bağlantı hatası" });
      }
    });
    req.end(body);
  });
}
