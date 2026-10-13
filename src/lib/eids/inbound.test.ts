import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processInboundMail, type InboundApplier, type InboundInsert, type InboundMessageRow, type InboundStore } from "./inbound";
import { decideInbound, matchProperties } from "./inbound-policy";
import type { PropertyMatchRow } from "./inbound-policy";

/**
 * Yönlendirici kabul testleri (bellek içi depo; DB yok). Fikstürler mail-parse.test.ts ile aynı (mailauth imzalı).
 * Kapsanan kabul ölçütleri: taklit From durum değiştirmez ve kuyruğa 'doğrulanamadı' düşer; aynı e-posta iki kez
 * gelirse ikinci olay açılmaz; başka göndericinin gövdesi yazılmaz; Gmail onay kodu kayda düşer.
 */
const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "eids-mail.fixture.json"), "utf8")) as Record<string, string> & {
  keys: { ticaret: string; google: string };
};
const resolver = async (name: string): Promise<string[][]> => {
  if (name === "eids2026._domainkey.ticaret.gov.tr") return [[`v=DKIM1; k=rsa; p=${fx.keys.ticaret}`]];
  if (name === "arc-20240605._domainkey.google.com") return [[`v=DKIM1; k=rsa; p=${fx.keys.google}`]];
  throw Object.assign(new Error("NXDOMAIN"), { code: "ENOTFOUND" });
};

const T = "00000000-0000-0000-0000-0000000000aa";
const P_SALE = "11111111-1111-1111-1111-111111111111";
const P_RENT = "22222222-2222-2222-2222-222222222222";

type Stored = InboundInsert & { id: string; authority_event_id?: string | null };

function memoryStore(props: Record<string, PropertyMatchRow[]>, autoApply = true) {
  const rows: Stored[] = [];
  let n = 0;
  const alerts: string[] = [];
  const store: InboundStore = {
    async insertMessage(row) {
      const clash = rows.find(
        (r) => r.tenant_id === row.tenant_id && ((row.message_id && r.message_id === row.message_id) || (row.body_sha256 && r.body_sha256 === row.body_sha256)),
      );
      if (clash) return { ok: false, conflict: true };
      const id = `m${++n}`;
      rows.push({ ...row, id });
      return { ok: true, id };
    },
    async findExisting(tenantId, keys) {
      return (rows.find((r) => r.tenant_id === tenantId && ((keys.messageId && r.message_id === keys.messageId) || (keys.bodySha && r.body_sha256 === keys.bodySha))) ??
        null) as InboundMessageRow | null;
    },
    async updateMessage(tenantId, id, patch) {
      const r = rows.find((x) => x.id === id && x.tenant_id === tenantId);
      if (r) Object.assign(r, patch);
      return Boolean(r);
    },
    async findSemanticDuplicate(tenantId, key) {
      return (
        rows.find(
          (r) =>
            r.tenant_id === tenantId &&
            r.eids_property_no === key.propertyNo &&
            r.parse_kind === key.kind &&
            r.valid_until === key.validUntil &&
            r.received_at >= key.sinceIso &&
            !["duplicate", "rejected", "dismissed"].includes(String(r.match_status)),
        )?.id ?? null
      );
    },
    async findPropertiesByEidsNo(_t, no) {
      return props[no] ?? [];
    },
    async readAutoApply() {
      return autoApply;
    },
    async touchAddress() {},
    async alertUnknownFormat(_t, id) {
      alerts.push(id);
    },
  };
  return { store, rows, alerts };
}

let applyCalls: Parameters<InboundApplier>[0][];
const apply: InboundApplier = async (input) => {
  applyCalls.push(input);
  return { ok: true, eventId: `ev-${applyCalls.length}` };
};

beforeEach(() => {
  applyCalls = [];
  vi.unstubAllEnvs();
});

const PROPS = {
  "1234567890": [{ id: P_SALE, transaction_type: "Satılık" }],
  "9876543210": [{ id: P_RENT, transaction_type: "Kiralık" }],
  "5555555555": [{ id: P_SALE, transaction_type: "Satılık" }],
};

describe("EİDS yönlendirici", () => {
  it("DKIM'li verme e-postası birebir eşleşince otomatik uygulanır (tek yazma: applyAuthorityEvent)", async () => {
    const { store, rows } = memoryStore(PROPS);
    const r = await processInboundMail(store, apply, { tenantId: T, via: "eml_upload", raw: fx.grantSigned, resolver });
    expect(r).toMatchObject({ ok: true, outcome: "applied", auth: "verified" });
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0]).toMatchObject({ propertyId: P_SALE, kind: "grant", source: "email_verified", validUntil: "2027-03-31", eidsPropertyNo: "1234567890", grantorName: "AHMET YILMAZ" });
    expect(rows[0]).toMatchObject({ match_status: "applied", property_id: P_SALE, authority_event_id: "ev-1", grantor_masked: "AH*** YI****" });
    // Malik adı düz saklanmaz.
    expect(JSON.stringify(rows[0])).not.toMatch(/AHMET|YILMAZ/);
  });

  it("ARC ile doğrulanan iptal (Gmail iletimi) kira portföyüne uygulanır", async () => {
    const { store } = memoryStore(PROPS);
    const r = await processInboundMail(store, apply, { tenantId: T, via: "eml_upload", raw: fx.revokeArc, resolver });
    expect(r).toMatchObject({ ok: true, outcome: "applied", auth: "verified_via_arc" });
    expect(applyCalls[0]).toMatchObject({ propertyId: P_RENT, kind: "revoke", validUntil: null });
  });

  it("taklit From (DKIM/ARC yok, SPF fail) hiçbir durumu değiştirmez, kuyruğa 'doğrulanamadı' düşer", async () => {
    const { store, rows } = memoryStore(PROPS);
    const r = await processInboundMail(store, apply, {
      tenantId: T,
      via: "smtp",
      raw: fx.spoof,
      direct: true,
      evidence: { dkim: [], arc: null, spf: { result: "fail", domain: "ticaret.gov.tr" }, dmarc: { result: "fail" } },
    });
    expect(r).toMatchObject({ ok: true, outcome: "queued", auth: "unverified" });
    expect(applyCalls).toHaveLength(0);
    expect(rows[0]).toMatchObject({ auth_result: "unverified", match_status: "queued" });
  });

  it("aynı e-posta iki kez gelirse ikinci olay açılmaz (Message-ID / gövde özeti / anlamsal)", async () => {
    const { store, rows } = memoryStore(PROPS);
    await processInboundMail(store, apply, { tenantId: T, via: "smtp", raw: fx.grantSigned, resolver });
    const again = await processInboundMail(store, apply, { tenantId: T, via: "eml_upload", raw: fx.grantSigned, resolver });
    expect(again).toMatchObject({ ok: true, outcome: "duplicate" });
    // Aynı metin yapıştırılırsa gövde özeti tutar.
    const pasted = await processInboundMail(store, apply, {
      tenantId: T,
      via: "paste",
      pasted: "1234567890 taşınmaz numaralı taşınmazın satışına ilişkin Elektronik İlan Doğrulama Sistemi (EİDS) üzerinden ilan verilmesi konusunda AHMET YILMAZ tarafından 31.03.2027 tarihine kadar yetkilendirildiniz.",
    });
    expect(pasted).toMatchObject({ ok: true });
    expect(["duplicate"]).toContain((pasted as { outcome: string }).outcome);
    // Farklı Message-ID ve biraz farklı metin ama aynı no/tür/bitiş (7 gün içinde) → 'tekrar' kaydı, olay yok.
    const resent = fx.grantSigned.replace("eids-grant-0001", "eids-grant-0002").replace("Sistemi (EİDS)", "Sistemi");
    const sem = await processInboundMail(store, apply, { tenantId: T, via: "smtp", raw: resent, evidence: { dkim: [{ domain: "ticaret.gov.tr", result: "pass" }], arc: null, spf: null, dmarc: null } });
    expect(sem).toMatchObject({ ok: true, outcome: "duplicate" });
    expect(rows.at(-1)).toMatchObject({ match_status: "duplicate", duplicate_of: rows[0]!.id });
    expect(applyCalls).toHaveLength(1);
  });

  it("başka göndericinin e-postası: gövde ve ham yazılmaz, yalnız 'reddedildi' izi", async () => {
    vi.stubEnv("EIDS_MAIL_KEY", "a".repeat(64));
    const { store, rows } = memoryStore(PROPS);
    const other = fx.grantSigned.replace("<eids.yetki@ticaret.gov.tr>", "<kampanya@pazarlama.example>");
    const r = await processInboundMail(store, apply, { tenantId: T, via: "smtp", raw: other, resolver });
    expect(r).toMatchObject({ ok: true, outcome: "rejected", auth: "rejected" });
    expect(rows[0]).toMatchObject({ auth_result: "rejected", match_status: "rejected", body_sha256: null, raw_eml_encrypted: null, parse_kind: null, from_addr: "ka***@pazarlama.example" });
    expect(JSON.stringify(rows[0])).not.toMatch(/taşınmaz|1234567890|AHMET/);
    // "Görünen ad" hilesi: From adı Bakanlık adresi, gerçek adres başka → yine reddedilir.
    const trick = fx.spoof.replace(/^From: .*$/m, 'From: "eids.yetki@ticaret.gov.tr" <saldirgan@kotu.example>');
    const t = await processInboundMail(store, apply, { tenantId: T, via: "smtp", raw: trick, resolver });
    expect(t).toMatchObject({ outcome: "rejected" });
    expect(applyCalls).toHaveLength(0);
  });

  it("EIDS_MAIL_KEY varsa ham .eml şifreli ve 30 gün süreli saklanır; yoksa hiç saklanmaz", async () => {
    vi.stubEnv("EIDS_MAIL_KEY", "b".repeat(64));
    const a = memoryStore(PROPS);
    await processInboundMail(a.store, apply, { tenantId: T, via: "eml_upload", raw: fx.grantSigned, resolver });
    expect(a.rows[0]!.raw_eml_encrypted).toMatch(/^\\x[0-9a-f]+$/);
    expect(Buffer.from(a.rows[0]!.raw_eml_encrypted!.slice(2), "hex").toString("utf8")).toMatch(/^v1\./);
    const days = (Date.parse(a.rows[0]!.raw_purge_after!) - Date.parse(a.rows[0]!.received_at)) / 86_400_000;
    expect(days).toBe(30);
    vi.stubEnv("EIDS_MAIL_KEY", "");
    const b = memoryStore(PROPS);
    await processInboundMail(b.store, apply, { tenantId: T, via: "eml_upload", raw: fx.grantSigned, resolver });
    expect(b.rows[0]).toMatchObject({ raw_eml_encrypted: null, raw_purge_after: null });
  });

  it("yapıştırılan metin her zaman doğrulanmamış: eşleşse de kuyruğa düşer", async () => {
    const { store } = memoryStore(PROPS);
    const r = await processInboundMail(store, apply, {
      tenantId: T,
      via: "paste",
      pasted: "9876543210 taşınmaz numaralı taşınmazın kiralanmasına ilişkin ilan konusunda Ayşe Demir tarafından verilen yetki iptal edilmiştir.",
    });
    expect(r).toMatchObject({ ok: true, outcome: "queued", auth: "unverified" });
    expect(applyCalls).toHaveLength(0);
  });

  it("kalıba uymayan e-posta unknown_format: platform uyarısı + maskeli örnek, olay yok", async () => {
    const { store, rows, alerts } = memoryStore(PROPS);
    const odd = fx.grantSigned.replace("tarihine kadar yetkilendirildiniz", "tarihine kadar yetki verildi");
    const r = await processInboundMail(store, apply, { tenantId: T, via: "smtp", raw: odd, evidence: { dkim: [], arc: null, spf: null, dmarc: null } });
    expect(r).toMatchObject({ ok: true, outcome: "unknown_format" });
    expect(alerts).toHaveLength(1);
    expect(rows[0]!.sample_masked).toBeTruthy();
    expect(rows[0]!.sample_masked).not.toMatch(/\d|AHMET/);
    expect(applyCalls).toHaveLength(0);
  });

  it("Gmail iletme onayı: Google DKIM'i geçerliyse kod/bağlantı 24 saat kayda düşer; imzasızsa reddedilir", async () => {
    const gmail = [
      "From: Gmail Ekibi <forwarding-noreply@google.com>",
      "To: yetki-abcdefghijkmnpqr@eids.emlaksoft.com.tr",
      "Subject: (#123456789) Gmail Yönlendirme Onayı - ofis@gmail.com adresinden posta al",
      "Message-ID: <fwd-1@google.com>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Onaylamak için: https://mail-settings.google.com/mail/vf-%5Babc%5D-xyz",
      "Onay kodu: 123456789",
      "",
    ].join("\r\n");
    const signed = memoryStore(PROPS);
    const ok = await processInboundMail(signed.store, apply, { tenantId: T, via: "smtp", raw: gmail, evidence: { dkim: [{ domain: "google.com", result: "pass" }], arc: null, spf: null, dmarc: null } });
    expect(ok).toMatchObject({ ok: true, outcome: "forward_confirmation" });
    expect(signed.rows[0]).toMatchObject({ parse_kind: "forward_confirmation", confirm_code: "123456789", confirm_provider: "gmail", body_sha256: null, raw_eml_encrypted: null });
    expect(signed.rows[0]!.confirm_url).toContain("https://mail-settings.google.com/mail/vf-");
    const unsigned = memoryStore(PROPS);
    const bad = await processInboundMail(unsigned.store, apply, { tenantId: T, via: "smtp", raw: gmail, evidence: { dkim: [], arc: null, spf: null, dmarc: null } });
    expect(bad).toMatchObject({ outcome: "rejected" });
    expect(unsigned.rows[0]!.confirm_code).toBeNull();
  });

  it("sahte kopya önce gelse de gerçek (doğrulanmış) kopya kaydı yükseltir ve uygulanır", async () => {
    const { store, rows } = memoryStore(PROPS);
    const first = await processInboundMail(store, apply, { tenantId: T, via: "smtp", raw: fx.grantSigned, evidence: { dkim: [], arc: null, spf: null, dmarc: null } });
    expect(first).toMatchObject({ outcome: "queued" });
    const real = await processInboundMail(store, apply, { tenantId: T, via: "eml_upload", raw: fx.grantSigned, resolver });
    expect(real).toMatchObject({ outcome: "applied", auth: "verified" });
    expect(rows).toHaveLength(1);
    expect(applyCalls).toHaveLength(1);
  });

  it("ayar kapalıysa doğrulanmış e-posta da onay bekler; defter hatasında kayıt kuyrukta kalır", async () => {
    const off = memoryStore(PROPS, false);
    expect(await processInboundMail(off.store, apply, { tenantId: T, via: "eml_upload", raw: fx.grantSigned, resolver })).toMatchObject({ outcome: "queued" });
    const failing = memoryStore(PROPS);
    const r = await processInboundMail(failing.store, async () => ({ ok: false, error: "defter yok" }), { tenantId: T, via: "eml_upload", raw: fx.grantSigned, resolver });
    expect(r).toMatchObject({ outcome: "queued", applyError: "defter yok" });
    expect(failing.rows[0]!.match_status).toBe("queued");
  });
});

describe("politika (saf)", () => {
  it("tür ayrımı ve aday listesi", () => {
    const rows = [
      { id: "a", transaction_type: "Satılık" },
      { id: "b", transaction_type: "Kiralık" },
    ];
    expect(matchProperties(rows, "rent")).toEqual({ kind: "exact", propertyId: "b" });
    expect(matchProperties([{ id: "a", transaction_type: "Satılık" }], "rent")).toEqual({ kind: "candidate", propertyIds: ["a"] });
    expect(matchProperties([], "sale")).toEqual({ kind: "none" });
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, transaction_type: "Satılık" }));
    expect((matchProperties(many, "sale") as { propertyIds: string[] }).propertyIds).toHaveLength(5);
  });

  it("yalnız doğrulanmış + birebir + yapıştırma değil + ayar açık → uygula", () => {
    const exact = { kind: "exact", propertyId: "x" } as const;
    expect(decideInbound({ auth: "verified", via: "smtp", match: exact, autoApply: true })).toEqual({ action: "apply", propertyId: "x" });
    expect(decideInbound({ auth: "verified_via_arc", via: "eml_upload", match: exact, autoApply: true }).action).toBe("apply");
    expect(decideInbound({ auth: "unverified", via: "smtp", match: exact, autoApply: true })).toEqual({ action: "queue", status: "queued" });
    expect(decideInbound({ auth: "verified", via: "paste", match: exact, autoApply: true })).toEqual({ action: "queue", status: "queued" });
    expect(decideInbound({ auth: "verified", via: "smtp", match: { kind: "none" }, autoApply: true })).toEqual({ action: "queue", status: "no_match" });
  });
});
