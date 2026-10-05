import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EARNINGS_FILE,
  EF_FILES,
  LOCK_KEY,
  PROMOTED_FILES,
  TIMEOUTS,
  bodyMd5FromFile,
  compareRow,
  exitCodeFor,
  findTransactionControl,
  formatResults,
  normalizeValue,
  parseRehearsalArgs,
  targetFilesFor,
  topLevelSql,
} from "./core";
import { BILLING_FUNCTIONS, EF_BILLING_FUNCTIONS, FILE_CHECKS, TX, allCatalogSql } from "./sql";
import { EF_ALLOWED_IDENTIFIERS, allEfCatalogSql } from "./ef-sql";

/**
 * SÖZLEŞME: migration provası (scripts/migration-rehearsal.ts, `npm run db:rehearse`) hiçbir şeyi kalıcı yazamaz.
 * DB'ye bağlanmaz; yalnız kaynak metni ve saf yardımcıları denetler.
 */
const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const runner = read("scripts/migration-rehearsal.ts");
const sqlModule = read("src/lib/migration-rehearsal/sql.ts");
const efSqlModule = read("src/lib/migration-rehearsal/ef-sql.ts");
const migration = (f: string) => read(`supabase/migrations/${f}`);

describe("kalıcılaştırma yasağı", () => {
  it("çalıştırıcı ve SQL kataloğu 'commit' kelimesini HİÇ içermez (sorgu, yorum, dizge)", () => {
    expect(runner).not.toMatch(/commit/i);
    expect(sqlModule).not.toMatch(/commit/i);
  });

  it("EF kataloğu kelimeyi YALNIZ izinli tanımlayıcılarda (RPC/durum adı) içerir; hiçbir EF SQL'i o deyimle başlamaz", () => {
    expect([...EF_ALLOWED_IDENTIFIERS]).toEqual(["ef_credit_commit", "committed_total", "committed"]);
    let rest = efSqlModule;
    for (const id of EF_ALLOWED_IDENTIFIERS) rest = rest.replace(new RegExp(`\\b${id}\\b`, "g"), "");
    expect(rest).not.toMatch(/commit/i);
    for (const sql of allEfCatalogSql()) {
      expect(sql, sql).toMatch(/^\s*(select|insert)\b/i);
      expect(sql).not.toMatch(/\b(begin|rollback|savepoint|release|end|abort|prepare)\b\s*(;|$)/i);
    }
  });

  it("katalogdaki her SQL tek deyimdir ve transaction'ı bitiren/başlatan deyim değildir (yalnız TX.begin)", () => {
    for (const sql of allCatalogSql()) {
      const top = topLevelSql(sql).toLowerCase();
      expect(top.replace(/;\s*$/, ""), sql).not.toContain(";");
      const first = /^\s*([a-z_]+)/.exec(top)?.[1] ?? "";
      expect(["commit", "end", "abort", "prepare", "start"], sql).not.toContain(first);
      if (first === "begin") expect(sql).toBe(TX.begin);
    }
  });

  it("çalıştırıcı yalnız katalog sabitlerini ve taramadan geçmiş migration metnini çalıştırır (satır içi SQL yok)", () => {
    expect(runner).not.toMatch(/\bq(?:<[^>]*>)?\(\s*["'`]/);
    expect(runner).not.toMatch(/client\.query(?:<[^>]*>)?\(\s*["'`]/);
    expect(runner).toContain("await q(SOURCES.get(file)!)");
    const guard = runner.indexOf("findTransactionControl(text)");
    const connect = runner.indexOf("await client.connect()");
    expect(guard).toBeGreaterThan(-1);
    expect(connect).toBeGreaterThan(guard);
  });

  it("ledger'a yazmaz: schema_migrations yalnız okunur", () => {
    const ledgerSql = allCatalogSql().filter((s) => /schema_migrations/i.test(s));
    expect(ledgerSql.length).toBeGreaterThan(0);
    for (const s of ledgerSql) expect(s).toMatch(/^\s*select\b/i);
    expect(runner).not.toMatch(/insert\s+into\s+public\.schema_migrations/i);
  });

  it("her çıkış yolunda ROLLBACK + bağlantı kapatma: finally, SIGINT/SIGTERM ve bekçi", () => {
    expect(TX.rollback).toBe("rollback");
    expect(runner).toMatch(/finally \{[\s\S]*?rollbackAndClose\(\)/);
    expect(runner).toContain('process.on("SIGINT"');
    expect(runner).toContain('process.on("SIGTERM"');
    expect(runner).toContain("TIMEOUTS.overallMs");
    expect(runner).toContain("client.query(TX.rollback)");
    expect(runner).toContain("client.end()");
  });

  it("apply-migrations ile aynı advisory anahtarı xact düzeyinde; zaman aşımları kısa", () => {
    const apply = read("scripts/apply-migrations.ts");
    const key = /const LOCK_KEY = ([\d_]+);/.exec(apply)?.[1]?.replace(/_/g, "");
    expect(Number(key)).toBe(LOCK_KEY);
    expect(TX.tryLock).toContain("pg_try_advisory_xact_lock");
    expect(TX.timeouts).toContain("statement_timeout");
    expect(TX.timeouts).toContain("lock_timeout");
    expect(TIMEOUTS).toMatchObject({ statement: "20s", lock: "10s" });
    expect(runner).toContain("TX.tryLock");
  });
});

describe("bayraklar (apply-migrations kadar sıkı)", () => {
  it("bilinmeyen bayrak, argüman ve tekrar reddedilir", () => {
    expect(parseRehearsalArgs(["--dry-run"]).ok).toBe(false);
    expect(parseRehearsalArgs(["--dry-run\\."]).ok).toBe(false);
    expect(parseRehearsalArgs(["evet"]).ok).toBe(false);
    expect(parseRehearsalArgs(["--yes-i-understand-locks", "--yes-i-understand-locks"]).ok).toBe(false);
  });

  it("geçerli bayraklar", () => {
    expect(parseRehearsalArgs([])).toEqual({ ok: true, flags: { yes: false, withEarnings: false, ef: false, help: false } });
    expect(parseRehearsalArgs(["--yes-i-understand-locks", "--with-earnings"])).toEqual({
      ok: true,
      flags: { yes: true, withEarnings: true, ef: false, help: false },
    });
    expect(parseRehearsalArgs(["--yes-i-understand-locks", "--ef"])).toEqual({
      ok: true,
      flags: { yes: true, withEarnings: false, ef: true, help: false },
    });
    expect(parseRehearsalArgs(["-h"])).toMatchObject({ ok: true, flags: { help: true } });
  });

  it("--ef ile --with-earnings birlikte verilemez; --ef yalnız EF kümesini hedefler", () => {
    expect(parseRehearsalArgs(["--ef", "--with-earnings"]).ok).toBe(false);
    expect(parseRehearsalArgs(["--ef", "--ef"]).ok).toBe(false);
    expect(targetFilesFor({ ef: true, withEarnings: false })).toEqual([...EF_FILES]);
    expect(targetFilesFor({ ef: false, withEarnings: false })).toEqual([...PROMOTED_FILES]);
    expect(targetFilesFor({ ef: false, withEarnings: true })).toEqual([...PROMOTED_FILES, EARNINGS_FILE]);
    expect([...EF_FILES]).toEqual([...EF_FILES].sort());
    expect(runner).toContain("targetFilesFor(flags)");
  });

  it("onay bayrağı yoksa bağlanmadan çıkış 2; bayrak hatası çıkış 2", () => {
    const noYes = runner.indexOf("if (!flags.yes)");
    expect(noYes).toBeGreaterThan(-1);
    expect(runner.indexOf("process.exit(2)", noYes)).toBeLessThan(runner.indexOf("await client.connect()"));
    expect(runner).toMatch(/if \(!parsed\.ok\) \{[\s\S]*?process\.exit\(2\)/);
  });
});

describe("migration dosyası güvenlik taraması", () => {
  it("hedef 14 dosyada + EF kümesinde üst düzey transaction denetimi / CONCURRENTLY / ADD VALUE yok", () => {
    for (const f of [...PROMOTED_FILES, EARNINGS_FILE, ...EF_FILES]) expect(findTransactionControl(migration(f)), f).toEqual([]);
  });

  it("dedektör kötü örnekleri yakalar, gövde/yorum/dizge içini yok sayar", () => {
    expect(findTransactionControl("select 1; commit;")).toHaveLength(1);
    expect(findTransactionControl("create table t(a int);\nend;")).toHaveLength(1);
    expect(findTransactionControl("BEGIN; select 1;")).toHaveLength(1);
    expect(findTransactionControl("create index concurrently i on t(a);")).toHaveLength(1);
    expect(findTransactionControl("alter type e add value 'x';")).toHaveLength(1);
    expect(findTransactionControl("do $$ begin perform 1; end $$;")).toEqual([]);
    expect(findTransactionControl("create function f() returns int language plpgsql as $f$ begin return 1; end; $f$;")).toEqual([]);
    expect(findTransactionControl("-- commit;\n/* end; */ select 'commit;' as x;")).toEqual([]);
    expect(findTransactionControl("select E'it\\'s; commit;' as x;")).toEqual([]);
    expect(findTransactionControl('select 1 as "end;";')).toEqual([]);
  });

  it("perf indeks önerileri (CONCURRENTLY) dedektöre takılır", () => {
    expect(findTransactionControl(read("supabase/proposed/20260814b_perf_indexes_measured.sql")).length).toBeGreaterThan(0);
  });
});

describe("fatura gövdesi md5 beklentileri dosyalardan doğru çıkarılıyor", () => {
  it("20260825000600 başlığındaki ÖNCE/SONRA md5'leri ile birebir", () => {
    const seat = migration("20260825000600_seat_purchase_fulfillment.sql");
    expect(bodyMd5FromFile(migration("20260825000300_billing_plan_amount_integrity.sql"), "fulfill_billing_payment")).toBe("a69a76095ddeafb4524bdcc634b25507");
    expect(bodyMd5FromFile(migration("20260810000100_billing_checkout_reconciliation.sql"), "fulfill_billing_payment_v2")).toBe("58632405633c6b701b7b330460e88f69");
    expect(bodyMd5FromFile(migration("20260802000320_plan_entitlements.sql"), "enforce_plan_capacity")).toBe("15a0a848fde39a1cb8271b0ff4a53f2a");
    expect(bodyMd5FromFile(migration("20260802000320_plan_entitlements.sql"), "enforce_tenant_plan_capacity")).toBe("55e3e409a53ba3140aa749e4a974ec37");
    expect(bodyMd5FromFile(seat, "enforce_plan_capacity")).toBe("e7cdf30c88c0ff4ef67077e5c3f1cdd7");
    expect(bodyMd5FromFile(seat, "enforce_tenant_plan_capacity")).toBe("bf75fbeb7e4336a8dcf42babd77d0917");
    expect(bodyMd5FromFile(seat, "fulfill_billing_payment")).toBe("0f5b4589c3608509d3c7390e08c7834d");
    expect(bodyMd5FromFile(seat, "fulfill_billing_payment_v2")).toBe("5fc1c6552b2fe6f963fb72ea3264e03e");
    expect(bodyMd5FromFile(seat.replace(/\n/g, "\r\n"), "fulfill_billing_payment")).toBe("0f5b4589c3608509d3c7390e08c7834d");
  });

  it("her fatura fonksiyonunun ÖNCE ve SONRA kaynağı tek tanım içerir", () => {
    for (const fn of [...BILLING_FUNCTIONS, ...EF_BILLING_FUNCTIONS]) {
      expect(bodyMd5FromFile(migration(fn.before), fn.name), `${fn.name} <- ${fn.before}`).toMatch(/^[0-9a-f]{32}$/);
      expect(bodyMd5FromFile(migration(fn.after), fn.name), `${fn.name} <- ${fn.after}`).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});

describe("kapsam ve sonuç tablosu", () => {
  it("her hedef dosyanın uygulama sonrası varlık kontrolü var", () => {
    for (const f of [...PROMOTED_FILES, EARNINGS_FILE, ...EF_FILES]) expect(FILE_CHECKS[f]?.post.length ?? 0, f).toBeGreaterThan(0);
    expect(Object.keys(FILE_CHECKS).sort()).toEqual([...PROMOTED_FILES, EARNINGS_FILE, ...EF_FILES].sort());
  });

  it("--ef md5 beklentileri: yalnız fulfill + v2 değişir, diğerleri ÖNCE = SONRA; canlı taban 000600 BEKLENEN SONRA", () => {
    const changed = EF_BILLING_FUNCTIONS.filter((f) => f.before !== f.after).map((f) => f.key);
    expect(changed).toEqual(["fulfill10", "fulfillV2"]);
    const seat = migration("20260825000600_seat_purchase_fulfillment.sql");
    expect(bodyMd5FromFile(seat, "fulfill_billing_payment")).toBe("0f5b4589c3608509d3c7390e08c7834d");
    expect(bodyMd5FromFile(seat, "fulfill_billing_payment_v2")).toBe("5fc1c6552b2fe6f963fb72ea3264e03e");
  });

  it("değer normalleştirme ve karşılaştırma", () => {
    expect([normalizeValue(true), normalizeValue(false), normalizeValue(null), normalizeValue("12")]).toEqual(["t", "f", "NULL", "12"]);
    expect(compareRow({ a: "1", b: true }, { a: "1", b: "t" })).toEqual([]);
    expect(compareRow({ a: "2" }, { a: "1" })).toHaveLength(1);
    expect(compareRow(undefined, { a: "1" })).toEqual(["satır dönmedi"]);
    expect(compareRow({ n: "17" }, { n: { test: (v) => Number(v) >= 16, describe: ">= 16" } })).toEqual([]);
  });

  it("FAIL varsa çıkış 1; ATLANDI tek başına başarısızlık değildir", () => {
    const base = { group: "g", id: "x", title: "t", detail: "" };
    expect(exitCodeFor([{ ...base, status: "PASS" }, { ...base, status: "ATLANDI" }])).toBe(0);
    expect(exitCodeFor([{ ...base, status: "FAIL" }])).toBe(1);
    expect(formatResults([{ ...base, status: "PASS" }])).toContain("1 PASS, 0 FAIL, 0 ATLANDI");
  });

  it("npm betiği tanımlı", () => {
    expect(JSON.parse(read("package.json")).scripts["db:rehearse"]).toBe("tsx scripts/migration-rehearsal.ts");
  });
});
