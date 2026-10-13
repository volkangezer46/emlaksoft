/**
 * Fonksiyon/tablo yetki (ACL) denetim kapısı — SALT OKUNUR.
 *
 * NEDEN: 2026-10 bulut → self-hosted geçişinde canlıda fonksiyon yetkileri kayboldu/genişledi (BUG-1/GUV-1):
 * migration zincirinin `revoke ... from anon, authenticated` ile kapattığı RPC'ler (merge_customers, write_setting,
 * insight_quiet_valuable_customers ...) Supabase varsayılan yetkileriyle yeniden anon'a açık kaldı. Onarım tek
 * seferlik betikle yapılır; bu kapı aynı açığın sessizce geri gelmesini yakalar.
 *
 * DENETİMLER
 *  1) anon-izin   : public şemada anon'un EXECUTE edebildiği ve `function-acl-allowlist.ts`'de olmayan her fonksiyon
 *                   HATA (tetikleyici fonksiyonları RPC olarak çağrılamaz, dışarıda).
 *  2) definer-p_tenant: SECURITY DEFINER + authenticated'a açık + `p_tenant%` parametresi alan ve gövdesinde
 *                   auth.uid / current_tenant_id / is_platform_ / has_effective_permission / auth.jwt / request.jwt
 *                   (ve p_tenant_id'yi JWT ile eşleyen assert_current_tenant) geçmeyen fonksiyon: kiracı kimliği istemciden geliyor ve doğrulanmıyor olabilir. UYARI
 *                   (`--strict` ile HATA).
 *  3) sapma       : `--shadow <dizin>` verilirse hedefin ACL'i, `scripts/db-shadow-replay.sh` çıktısıyla (migration
 *                   zincirinin sıfırdan kurulumu = niyet edilen durum) karşılaştırılır. Yalnız anon, authenticated ve
 *                   PUBLIC hakları kıyaslanır (service_role/postgres/supabase_admin bilerek dışarıda). Fark HATA.
 *
 * BAĞLANTI (yalnız okuma; oturum default_transaction_read_only=on):
 *   --url <postgres-url>       doğrudan bağlantı (varsayılan: ACL_DATABASE_URL, sonra .env.local DATABASE_URL)
 *   --container <docker-adı>   `docker exec <ad> psql -U supabase_admin` (canlı ya da gölge konteyner)
 *
 * KULLANIM
 *   npm run check:acl                                       # .env.local veritabanı, 1+2
 *   npm run check:acl -- --container supabase-db-... --shadow /tmp/golge   # canlı ↔ gölge sapması dahil
 *   npm run check:acl -- --warn                             # yalnız uyarı (çıkış 0)
 *   npm run check:acl -- --strict                           # definer-p_tenant da çıkış kodunu etkiler
 *   npm run check:acl -- --container <ad> --dump <dizin>    # function-acl.tsv + relation-acl.tsv yaz (gölge betiği)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { ANON_FUNCTION_ALLOWLIST } from "./function-acl-allowlist.ts";

type Row = string[];
export type AclSource = { kind: "url"; url: string } | { kind: "container"; name: string };
export type AclCheckOptions = { source: AclSource; shadowDir?: string; strict?: boolean };
export type AclFinding = { level: "error" | "warn" | "info"; kind: string; object: string; detail: string };

/** Denetlenen roller. service_role/postgres/supabase_admin bilerek dışarıda. "" = PUBLIC. */
const ROLES = ["anon", "authenticated", ""] as const;

// Uzantıya ait nesneler (pg_depend 'e') dışarıda: onların yetkisini uzantı yönetir.
export const FUNCTION_ACL_SQL = `
  select p.oid::regprocedure::text, coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))::text
  from pg_catalog.pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  order by 1`;
export const RELATION_ACL_SQL = `
  select c.relname::text, c.relkind::text,
         coalesce(c.relacl, pg_catalog.acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))::text
  from pg_catalog.pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  order by 1`;
const ANON_EXEC_SQL = `
  select p.oid::regprocedure::text
  from pg_catalog.pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
    and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
    and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  order by 1`;
const DEFINER_TENANT_PARAM_SQL = `
  select p.oid::regprocedure::text
  from pg_catalog.pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.prosecdef
    and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and exists (select 1 from pg_catalog.unnest(p.proargnames) a(n) where a.n like 'p\\_tenant%')
    and p.prosrc !~* '(auth\\.uid|current_tenant_id|assert_current_tenant|is_platform_|has_effective_permission|auth\\.jwt|request\\.jwt)'
  order by 1`;

async function runQueries(source: AclSource, sqls: readonly string[]): Promise<Row[][]> {
  const prelude = "set default_transaction_read_only = on; set search_path = pg_catalog;";
  if (source.kind === "container") {
    return sqls.map((sql) => {
      const out = execFileSync(
        "docker",
        [
          "exec", source.name, "psql", "-h", "/var/run/postgresql", "-U", "supabase_admin", "-d", "postgres",
          "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c", `${prelude} ${sql}`,
        ],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      );
      return out.split("\n").filter((line) => line.length > 0).map((line) => line.split("\t"));
    });
  }
  const ssl = /sslmode=disable/.test(source.url) ? false : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: source.url, ssl });
  await client.connect();
  try {
    await client.query(prelude);
    const results: Row[][] = [];
    for (const sql of sqls) {
      const r = await client.query({ text: sql, rowMode: "array" });
      results.push(r.rows.map((row: unknown[]) => row.map((v) => (v == null ? "" : String(v)))));
    }
    return results;
  } finally {
    await client.end();
  }
}

/** `{anon=X/postgres,"x y"=r/postgres,=X/postgres}` → rol → hak harfleri (grant option '*' ve grantor atılır). */
export function parseAcl(acl: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = acl.replace(/^\{|\}$/g, "");
  if (!body) return out;
  const items: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of body) {
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      items.push(cur);
      cur = "";
    } else cur += ch;
  }
  items.push(cur);
  for (const raw of items) {
    // Dizi öğesi tırnaklıysa çöz; aclitem biçimi: grantee=hakl/grantor (grantee boş = PUBLIC).
    const item = raw.replace(/^"|"$/g, "").replace(/\\"/g, '"');
    const slash = item.lastIndexOf("/");
    const eq = item.lastIndexOf("=", slash >= 0 ? slash : item.length);
    if (eq < 0) continue;
    const grantee = item.slice(0, eq).replace(/^"|"$/g, "");
    const privs = item.slice(eq + 1, slash >= 0 ? slash : undefined).replace(/\*/g, "");
    out.set(grantee, [...new Set([...(out.get(grantee) ?? "") + privs])].sort().join(""));
  }
  return out;
}

function roleLabel(role: string): string {
  return role === "" ? "PUBLIC" : role;
}

/** İki ACL arasında anon/authenticated/PUBLIC farkları; boş dizi = aynı. */
export function aclRoleDiff(target: string, shadow: string): string[] {
  const a = parseAcl(target);
  const b = parseAcl(shadow);
  const diffs: string[] = [];
  for (const role of ROLES) {
    const have = a.get(role) ?? "";
    const want = b.get(role) ?? "";
    if (have !== want) diffs.push(`${roleLabel(role)}: hedef '${have || "-"}' / gölge '${want || "-"}'`);
  }
  return diffs;
}

function readTsv(file: string): Row[] {
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0).map((l) => l.split("\t"));
}

function writeTsv(file: string, rows: Row[]): void {
  fs.writeFileSync(file, rows.map((r) => r.join("\t")).join("\n") + (rows.length ? "\n" : ""));
}

export async function dumpAcl(source: AclSource, dir: string): Promise<{ functions: number; relations: number }> {
  const [fns, rels] = await runQueries(source, [FUNCTION_ACL_SQL, RELATION_ACL_SQL]);
  fs.mkdirSync(dir, { recursive: true });
  writeTsv(path.join(dir, "function-acl.tsv"), fns!);
  writeTsv(path.join(dir, "relation-acl.tsv"), rels!);
  return { functions: fns!.length, relations: rels!.length };
}

export async function runAclCheck(opts: AclCheckOptions): Promise<AclFinding[]> {
  const [anonExec, definerTenant, fns, rels] = await runQueries(opts.source, [
    ANON_EXEC_SQL,
    DEFINER_TENANT_PARAM_SQL,
    FUNCTION_ACL_SQL,
    RELATION_ACL_SQL,
  ]);
  const findings: AclFinding[] = [];

  // 1) anon'a açık ama listede olmayan
  const anonSet = new Set(anonExec!.map((r) => r[0]!));
  for (const sig of anonSet) {
    if (!ANON_FUNCTION_ALLOWLIST[sig]) {
      findings.push({ level: "error", kind: "anon-izin", object: sig, detail: "anon EXECUTE edebiliyor; kabul listesinde yok" });
    }
  }
  for (const sig of Object.keys(ANON_FUNCTION_ALLOWLIST)) {
    if (!anonSet.has(sig)) {
      findings.push({ level: "info", kind: "liste-bayat", object: sig, detail: "kabul listesinde ama anon'a açık değil / yok" });
    }
  }

  // 2) DEFINER + p_tenant% + kimlik denetimi görünmeyen gövde
  for (const [sig] of definerTenant!) {
    findings.push({
      level: opts.strict ? "error" : "warn",
      kind: "definer-p_tenant",
      object: sig!,
      detail: "SECURITY DEFINER, authenticated'a açık, p_tenant% alıyor; gövdede auth.uid/current_tenant_id/izin denetimi yok",
    });
  }

  // 3) gölge ile sapma
  if (opts.shadowDir) {
    const compare = (kind: string, target: Row[], shadow: Row[], key: (r: Row) => string, acl: (r: Row) => string) => {
      const shadowMap = new Map(shadow.map((r) => [key(r), acl(r)]));
      const targetKeys = new Set<string>();
      const onlyTarget: string[] = [];
      for (const r of target) {
        const k = key(r);
        targetKeys.add(k);
        const want = shadowMap.get(k);
        if (want === undefined) {
          onlyTarget.push(k);
          continue;
        }
        for (const d of aclRoleDiff(acl(r), want)) findings.push({ level: "error", kind: `sapma-${kind}`, object: k, detail: d });
      }
      const onlyShadow = [...shadowMap.keys()].filter((k) => !targetKeys.has(k));
      if (onlyTarget.length > 0) {
        findings.push({
          level: "info",
          kind: `yalniz-hedefte-${kind}`,
          object: `${onlyTarget.length} nesne`,
          detail: `gölgede yok (zincir dışı nesne ya da imza farkı): ${onlyTarget.slice(0, 5).join(", ")}`,
        });
      }
      if (onlyShadow.length > 0) findings.push({ level: "info", kind: `yalniz-golgede-${kind}`, object: `${onlyShadow.length} nesne`, detail: onlyShadow.slice(0, 5).join(", ") });
    };
    compare("fonksiyon", fns!, readTsv(path.join(opts.shadowDir, "function-acl.tsv")), (r) => r[0]!, (r) => r[1] ?? "");
    compare("iliski", rels!, readTsv(path.join(opts.shadowDir, "relation-acl.tsv")), (r) => `${r[0]} (${r[1]})`, (r) => r[2] ?? "");
  }
  return findings;
}

export function printFindings(findings: readonly AclFinding[], warnOnly: boolean): { errors: number; warnings: number } {
  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.filter((f) => f.level === "warn").length;
  const groups = new Map<string, AclFinding[]>();
  for (const f of findings) groups.set(`${f.level}:${f.kind}`, [...(groups.get(`${f.level}:${f.kind}`) ?? []), f]);
  for (const [k, list] of [...groups].sort()) {
    const [level, kind] = k.split(":");
    const tag = level === "error" && warnOnly ? "UYARI" : level === "error" ? "HATA" : level === "warn" ? "UYARI" : "BILGI";
    console.log(`\n[${tag}] ${kind} — ${list.length}`);
    for (const f of list.slice(0, 200)) console.log(`   ${f.object}: ${f.detail}`);
    if (list.length > 200) console.log(`   ... +${list.length - 200}`);
  }
  console.log(`\nACL denetimi: ${errors} hata, ${warnings} uyarı${warnOnly ? " (--warn: çıkış kodunu etkilemez)" : ""}.`);
  return { errors, warnings };
}

export function sourceFromArgs(args: readonly string[]): AclSource {
  const val = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const container = val("--container");
  if (container) return { kind: "container", name: container };
  dotenv.config({ path: ".env.local", quiet: true });
  const url = val("--url") ?? process.env.ACL_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Bağlantı yok: --url, --container ya da ACL_DATABASE_URL/DATABASE_URL (.env.local) gerekli.");
  return { kind: "url", url };
}

const KNOWN = new Set(["--url", "--container", "--shadow", "--dump", "--warn", "--strict", "--help", "-h"]);
const WITH_VALUE = new Set(["--url", "--container", "--shadow", "--dump"]);

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Kullanım: npm run check:acl -- [--url <url> | --container <ad>] [--shadow <dizin>] [--warn | --strict] [--dump <dizin>]");
    return 0;
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!KNOWN.has(a)) {
      console.error(`Bilinmeyen argüman: ${a} (--help)`);
      return 2;
    }
    if (WITH_VALUE.has(a)) {
      if (!args[i + 1] || args[i + 1]!.startsWith("--")) {
        console.error(`${a} bir değer ister.`);
        return 2;
      }
      i += 1;
    }
  }
  if (args.includes("--warn") && args.includes("--strict")) {
    console.error("--warn ve --strict birlikte kullanılamaz.");
    return 2;
  }
  const source = sourceFromArgs(args);
  const dumpIdx = args.indexOf("--dump");
  if (dumpIdx >= 0) {
    const dir = args[dumpIdx + 1]!;
    const n = await dumpAcl(source, dir);
    console.log(`ACL dökümü: ${n.functions} fonksiyon, ${n.relations} ilişki → ${dir}`);
    return 0;
  }
  const shadowIdx = args.indexOf("--shadow");
  const findings = await runAclCheck({
    source,
    shadowDir: shadowIdx >= 0 ? args[shadowIdx + 1] : undefined,
    strict: args.includes("--strict"),
  });
  const warnOnly = args.includes("--warn");
  const { errors } = printFindings(findings, warnOnly);
  return errors > 0 && !warnOnly ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
