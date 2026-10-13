/**
 * EmlakSoft EİDS posta alıcısı (EP3) — yalnız eids.emlaksoft.com.tr için GELEN posta; açık röle DEĞİLDİR, dışarı posta
 * göndermez. Node 24 (tip ayıklama ile doğrudan `node server.ts`), smtp-server + mailauth.
 *
 * Akış:
 *  1) Bağlantı: IP başına hız sınırı (10 dakikada 30 bağlantı, saatte 60 ileti); aşılırsa 421 (gönderen sonra dener).
 *  2) RCPT TO: alıcı yalnız `yetki-<16 karakter>@eids.emlaksoft.com.tr` olabilir; başka alan adı → 550 (röle yok).
 *     Anahtar uygulamaya HMAC imzalı `op:"rcpt"` ile sorulur (60 sn önbellek): bilinmeyen/yenilenmiş anahtar → 550.
 *  3) DATA: en çok 256 KB (aşan → 552). mailauth ile DKIM, SPF (istemci IP + MAIL FROM), ARC, DMARC hesaplanır;
 *     ham ileti + kanıt `op:"deliver"` ile /api/inbound/eids uç noktasına POST edilir. Uygulama hatasında 451 (geçici,
 *     gönderen yeniden dener; uç nokta Message-ID/gövde özetiyle idempotent).
 * Ham ileti diske yazılmaz, günlüğe içerik/adres yazılmaz (yalnız sonuç kodu ve IP'nin ilk iki okteti).
 *
 * Ortam: EIDS_INBOUND_SECRET (zorunlu, uygulamayla aynı; ≥32 karakter), EIDS_APP_URL (varsayılan
 * http://emlaksoft-app:3000/api/inbound/eids), EIDS_SMTP_PORT (varsayılan 2525; compose host 25 → 2525 eşler),
 * EIDS_MTA_NAME (varsayılan mx.emlaksoft.com.tr), isteğe bağlı EIDS_TLS_KEY / EIDS_TLS_CERT (dosya yolu; STARTTLS).
 * Kurulum: scripts/sunucu/install-eids-inbound.sh
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { SMTPServer } from "smtp-server";
import { authenticate } from "mailauth";

const SECRET = (process.env.EIDS_INBOUND_SECRET ?? "").trim();
const APP_URL = process.env.EIDS_APP_URL ?? "http://emlaksoft-app:3000/api/inbound/eids";
const PORT = Number(process.env.EIDS_SMTP_PORT ?? 2525);
const MTA = process.env.EIDS_MTA_NAME ?? "mx.emlaksoft.com.tr";
const DOMAIN = "eids.emlaksoft.com.tr";
const MAX_BYTES = 256 * 1024;
const MAX_RCPT = 5;
const RCPT_RE = /^yetki-[a-z0-9]{16}@eids\.emlaksoft\.com\.tr$/;

if (SECRET.length < 32) {
  console.error("EIDS_INBOUND_SECRET tanımlı değil ya da 32 karakterden kısa; alıcı başlatılmadı.");
  process.exit(1);
}

type SmtpError = Error & { responseCode?: number };
function smtpError(code: number, message: string): SmtpError {
  const e: SmtpError = new Error(message);
  e.responseCode = code;
  return e;
}

// --- IP başına hız sınırı (bellek içi kayan pencere) ----------------------------------------------------------------
const hits = new Map<string, { conn: number[]; msg: number[] }>();
function allow(ip: string, kind: "conn" | "msg"): boolean {
  const nowMs = Date.now();
  const rec = hits.get(ip) ?? { conn: [], msg: [] };
  const windowMs = kind === "conn" ? 10 * 60_000 : 60 * 60_000;
  const limit = kind === "conn" ? 30 : 60;
  rec[kind] = rec[kind].filter((t) => nowMs - t < windowMs);
  if (rec[kind].length >= limit) {
    hits.set(ip, rec);
    return false;
  }
  rec[kind].push(nowMs);
  hits.set(ip, rec);
  if (hits.size > 50_000) hits.clear();
  return true;
}
const maskIp = (ip: string) => ip.split(".").slice(0, 2).join(".") + ".x.x";

// --- Uygulama köprüsü (HMAC imzalı) ---------------------------------------------------------------------------------
async function callApp(payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`, "utf8").digest("hex");
  const res = await fetch(APP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-eids-timestamp": String(ts), "x-eids-signature": sig },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* gövdesiz yanıt */
  }
  return { status: res.status, body: json };
}

const rcptCache = new Map<string, { accept: boolean; at: number }>();
async function recipientKnown(address: string): Promise<boolean | null> {
  const c = rcptCache.get(address);
  if (c && Date.now() - c.at < 60_000) return c.accept;
  try {
    const r = await callApp({ op: "rcpt", rcpt: address });
    if (r.status !== 200) return null;
    const accept = r.body.accept === true;
    rcptCache.set(address, { accept, at: Date.now() });
    if (rcptCache.size > 10_000) rcptCache.clear();
    return accept;
  } catch {
    return null;
  }
}

// --- mailauth sonucu → uygulamanın kanıt şeması (src/lib/eids/mail-auth.ts MailAuthEvidence) -------------------------
function arcSets(raw: string): { i: number; sealer: string; aar: string }[] {
  const head = raw.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const fields = head.replace(/\r?\n(?=[ \t])/g, "").split(/\r?\n/);
  const byI = new Map<number, { sealer: string; aar: string }>();
  for (const f of fields) {
    const m = /^(arc-seal|arc-authentication-results)\s*:(.*)$/i.exec(f);
    if (!m) continue;
    const value = m[2] ?? "";
    const i = Number(/(?:^|;)\s*i\s*=\s*(\d+)/.exec(value)?.[1] ?? NaN);
    if (!Number.isInteger(i)) continue;
    const slot = byI.get(i) ?? { sealer: "", aar: "" };
    if (m[1]!.toLowerCase() === "arc-seal") slot.sealer = (/(?:^|;)\s*d\s*=\s*([^;\s]+)/.exec(value)?.[1] ?? "").toLowerCase();
    else slot.aar = value.trim().slice(0, 2000);
    byI.set(i, slot);
  }
  return [...byI.entries()].sort((a, b) => a[0] - b[0]).slice(0, 10).map(([i, s]) => ({ i, ...s }));
}

type AuthResult = Awaited<ReturnType<typeof authenticate>>;
function evidenceOf(res: AuthResult, raw: string) {
  const r = res as unknown as {
    dkim?: { results?: { signingDomain?: string; status?: { result?: string } }[] };
    spf?: { status?: { result?: string }; domain?: string } | false;
    arc?: { status?: { result?: string } };
    dmarc?: { status?: { result?: string } } | false;
  };
  return {
    dkim: (r.dkim?.results ?? []).filter((d) => d.signingDomain).slice(0, 5).map((d) => ({ domain: String(d.signingDomain).toLowerCase(), result: String(d.status?.result ?? "none") })),
    arc: r.arc?.status?.result && r.arc.status.result !== "none" ? { result: r.arc.status.result, sets: arcSets(raw) } : null,
    spf: r.spf ? { result: String(r.spf.status?.result ?? "none"), domain: r.spf.domain ? String(r.spf.domain).toLowerCase() : null } : null,
    dmarc: r.dmarc ? { result: String(r.dmarc.status?.result ?? "none") } : null,
  };
}

// --- SMTP sunucusu --------------------------------------------------------------------------------------------------
const tls =
  process.env.EIDS_TLS_KEY && process.env.EIDS_TLS_CERT
    ? { key: readFileSync(process.env.EIDS_TLS_KEY), cert: readFileSync(process.env.EIDS_TLS_CERT) }
    : null;

const server = new SMTPServer({
  name: MTA,
  banner: "EmlakSoft EIDS alicisi",
  size: MAX_BYTES,
  authOptional: true,
  // AUTH yok: kimlik doğrulayıp röle yapmak mümkün değil. TLS sertifikası yoksa STARTTLS ilan edilmez.
  disabledCommands: tls ? ["AUTH"] : ["AUTH", "STARTTLS"],
  ...(tls ?? {}),
  logger: false,
  socketTimeout: 60_000,
  closeTimeout: 10_000,
  maxClients: 50,
  onConnect(session, callback) {
    const ip = session.remoteAddress ?? "";
    if (!allow(ip, "conn")) return callback(smtpError(421, "4.7.0 Cok fazla baglanti, daha sonra deneyin"));
    return callback();
  },
  async onRcptTo(address, session, callback) {
    const rcpt = String(address.address ?? "").trim().toLowerCase();
    if (!rcpt.endsWith(`@${DOMAIN}`)) return callback(smtpError(550, "5.7.1 Role yapilmaz (relay denied)"));
    if (session.envelope.rcptTo.length >= MAX_RCPT) return callback(smtpError(452, "4.5.3 Cok fazla alici"));
    if (!RCPT_RE.test(rcpt)) return callback(smtpError(550, "5.1.1 Boyle bir posta kutusu yok"));
    const known = await recipientKnown(rcpt);
    if (known === null) return callback(smtpError(451, "4.3.0 Gecici hata, daha sonra deneyin"));
    if (!known) return callback(smtpError(550, "5.1.1 Boyle bir posta kutusu yok"));
    return callback();
  },
  onData(stream, session, callback) {
    const ip = session.remoteAddress ?? "";
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BYTES) chunks.push(c);
    });
    stream.on("end", async () => {
      if ((stream as unknown as { sizeExceeded?: boolean }).sizeExceeded || size > MAX_BYTES) {
        return callback(smtpError(552, "5.3.4 Ileti 256 KB sinirini asiyor"));
      }
      if (!allow(ip, "msg")) return callback(smtpError(421, "4.7.0 Cok fazla ileti, daha sonra deneyin"));
      const raw = Buffer.concat(chunks);
      try {
        const sender = session.envelope.mailFrom ? String(session.envelope.mailFrom.address ?? "") : "";
        const auth = await authenticate(raw, { ip, helo: session.hostNameAppearsAs, sender, mta: MTA, disableBimi: true });
        const evidence = evidenceOf(auth, raw.toString("latin1"));
        let temp = false;
        for (const r of session.envelope.rcptTo) {
          const res = await callApp({
            op: "deliver",
            rcpt: String(r.address).toLowerCase(),
            raw_b64: raw.toString("base64"),
            evidence,
            client_ip: ip,
          });
          console.log(`eids-inbound deliver ip=${maskIp(ip)} status=${res.status} outcome=${String(res.body.outcome ?? res.body.error ?? "-")}`);
          if (res.status >= 500 || res.status === 429) temp = true;
        }
        if (temp) return callback(smtpError(451, "4.3.0 Gecici hata, daha sonra deneyin"));
        return callback(null, "Alindi");
      } catch (e) {
        console.error("eids-inbound hata", e instanceof Error ? e.name : "bilinmiyor");
        return callback(smtpError(451, "4.3.0 Gecici hata, daha sonra deneyin"));
      }
    });
  },
});

server.on("error", (e) => console.error("eids-inbound sunucu hatası", (e as Error).message));
server.listen(PORT, () => console.log(`eids-inbound ${PORT} portunda dinliyor (yalnız ${DOMAIN})`));

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
