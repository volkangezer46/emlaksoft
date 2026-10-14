import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it } from "vitest";

/**
 * KQ4 — işletim betikleri (error-watch, cron-call, release, rollback, host-metrics).
 * Canlıya DOKUNMAZ: `docker` / `npm` / `git` PATH'te sahte betiklerle değiştirilir (her çağrı günlüğe yazılır); SQL
 * parçaları pglite'ta çalıştırılır (psql değişkenleri literal ile değiştirilerek). shellcheck kuruluysa (PATH ya da
 * SHELLCHECK) betikler ayrıca denetlenir.
 */
const ROOT = process.cwd();
const DIR = path.join(ROOT, "scripts/sunucu");
const tmp = mkdtempSync(path.join(tmpdir(), "ops-scripts-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const FAKE_DOCKER = `#!/usr/bin/env bash
# Sahte docker: çağrıları günlüğe yazar; davranış FAKE_* ortamıyla.
echo "docker $*" >> "$FAKE_DIR/calls.log"
has() { local w; for w in "\${@:2}"; do [ "$w" = "$1" ] && return 0; done; return 1; }
case "$1" in
  exec)
    if has curl "$@"; then
      n=$(cat "$FAKE_DIR/curl_n" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$FAKE_DIR/curl_n"
      read -r -a codes <<< "\${FAKE_CODES:-200}"
      printf '%s' "\${codes[$((n - 1))]:-200}"; exit 0
    fi
    if has psql "$@"; then
      input=$(cat)
      printf -- '--ARGS %s\\n%s\\n' "$*" "$input" >> "$FAKE_DIR/psql.log"
      if [ -n "\${FAKE_PSQL_OUT:-}" ]; then cat "$FAKE_PSQL_OUT"; fi
      exit "\${FAKE_PSQL_RC:-0}"
    fi
    exit 0 ;;
  inspect)
    case "$*" in
      *Config.Image*) [ -n "\${FAKE_IMAGE:-}" ] && echo "$FAKE_IMAGE" ;;
    esac
    exit 0 ;;
  image) exit "\${FAKE_IMAGE_RC:-0}" ;;
  images) for t in \${FAKE_TAGS:-}; do echo "$t"; done; exit 0 ;;
  ps) exit 1 ;;
esac
exit 0
`;

function fakeBin(name: string, extra: Record<string, string> = {}) {
  const dir = path.join(tmp, name);
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "docker"), FAKE_DOCKER);
  chmodSync(path.join(bin, "docker"), 0o755);
  for (const [cmd, body] of Object.entries(extra)) {
    writeFileSync(path.join(bin, cmd), body);
    chmodSync(path.join(bin, cmd), 0o755);
  }
  return { dir, bin };
}

function run(script: string, args: string[], env: Record<string, string>, binDir: string, cwd = ROOT) {
  const r = spawnSync("bash", [script, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    env: { PATH: `${binDir}:${process.env.PATH}`, HOME: tmp, ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/** Betikteki ilk `<<'SQL' … SQL` gövdesi. */
function heredoc(script: string, after = ""): string {
  const src = readFileSync(path.join(DIR, script), "utf8");
  const from = after ? src.indexOf(after) : 0;
  const start = src.indexOf("<<'SQL'", from);
  const body = src.slice(src.indexOf("\n", start) + 1);
  return body.slice(0, body.indexOf("\nSQL\n"));
}
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
function bind(sql: string, vars: Record<string, string>): string {
  return sql.replace(/:'(\w+)'/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`değişken yok: ${k}`);
    return lit(vars[k]);
  });
}

describe("cron-call.sh: yeniden deneme + hata nabzı", () => {
  function cronCall(codes: string, name: string) {
    const { dir, bin } = fakeBin(name);
    writeFileSync(path.join(dir, "env"), "CRON_SECRET=test-secret\n");
    const r = run(path.join(DIR, "cron-call.sh"), ["/api/cron/ornek-is"], {
      FAKE_DIR: dir, FAKE_CODES: codes, CRON_ENV_FILE: path.join(dir, "env"), CRON_LOCK_DIR: dir, CRON_RETRY_DELAY: "0",
    }, bin);
    return { ...r, dir, curls: Number(read(path.join(dir, "curl_n")) || 0), psql: read(path.join(dir, "psql.log")) };
  }

  it("200 → tek çağrı, nabız yazılmaz", () => {
    const r = cronCall("200", "cc-ok");
    expect(r.code).toBe(0);
    expect(r.curls).toBe(1);
    expect(r.psql).toBe("");
  });

  it("503 sonra 200 → bir yeniden deneme, nabız yazılmaz", () => {
    const r = cronCall("503 200", "cc-retry-ok");
    expect(r.code).toBe(0);
    expect(r.curls).toBe(2);
    expect(r.out).toContain("yeniden denenecek");
    expect(r.psql).toBe("");
  });

  it("500 iki kez → tam bir yeniden deneme, cron_heartbeats'e error satırı", () => {
    const r = cronCall("500 500 500", "cc-fail");
    expect(r.code).toBe(1);
    expect(r.curls).toBe(2);
    expect(r.psql).toContain("insert into public.cron_heartbeats");
    expect(r.psql).toContain("job=ornek-is");
    expect(r.psql).toContain("detail=HTTP 500 (çağrı)");
    expect(r.psql).toContain("'error'");
  });

  it("nabız SQL'i: error yazar; rotanın aynı çağrıdaki hata ayrıntısını korur", async () => {
    const db = new PGlite();
    await db.exec(`create table public.cron_heartbeats (job text primary key, last_run_at timestamptz not null default now(),
      last_status text not null default 'ok', last_detail text);`);
    const sql = heredoc("cron-call.sh");
    // Satır yok → yeni error satırı.
    await db.exec(bind(sql, { job: "a", detail: "HTTP 500 (çağrı)", since: "2000-01-01T00:00:00Z" }));
    // Eski ok satırı → error'a döner, ayrıntı yalnız çağrı kodu.
    await db.exec(`insert into public.cron_heartbeats values ('b', now() - interval '1 day', 'ok', 'eski')`);
    await db.exec(bind(sql, { job: "b", detail: "HTTP 502 (çağrı)", since: new Date(Date.now() - 60_000).toISOString() }));
    // Rota bu çağrıda kendi hatasını yazmış → ayrıntısı arkaya eklenir.
    await db.exec(`insert into public.cron_heartbeats values ('c', now(), 'error', '3 kayıt başarısız')`);
    await db.exec(bind(sql, { job: "c", detail: "HTTP 500 (çağrı)", since: new Date(Date.now() - 60_000).toISOString() }));
    const rows = (await db.query<{ job: string; last_status: string; last_detail: string }>(
      "select job, last_status, last_detail from public.cron_heartbeats order by job")).rows;
    expect(rows).toEqual([
      { job: "a", last_status: "error", last_detail: "HTTP 500 (çağrı)" },
      { job: "b", last_status: "error", last_detail: "HTTP 502 (çağrı)" },
      { job: "c", last_status: "error", last_detail: "HTTP 500 (çağrı) — 3 kayıt başarısız" },
    ]);
  });
});

describe("error-watch.sh: (last_seen, id) imleci", () => {
  const ID1 = "11111111-1111-1111-1111-111111111111";
  const ID2 = "22222222-2222-2222-2222-222222222222";

  it("yazdığı satırlardan sonra imleci µs + id olarak kaydeder ve sonraki turda onu gönderir", () => {
    const { dir, bin } = fakeBin("ew");
    const out = path.join(dir, "psql-out");
    writeFileSync(out, [
      `2026-10-14T10:00:00.123456Z\t${ID1}\t{"zaman" : "2026-10-14T10:00:00Z", "id" : "${ID1}"}`,
      `2026-10-14T10:00:00.123456Z\t${ID2}\t{"zaman" : "2026-10-14T10:00:00Z", "id" : "${ID2}"}`,
    ].join("\n") + "\n");
    const env = { FAKE_DIR: dir, ERROR_WATCH_OUT_DIR: dir, ERROR_WATCH_ONCE: "1" };
    const first = run(path.join(DIR, "error-watch.sh"), [], { ...env, FAKE_PSQL_OUT: out }, bin);
    expect(first.code).toBe(0);
    const lines = read(path.join(dir, "hatalar.jsonl")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).id).toBe(ID2);
    expect(read(path.join(dir, "hatalar.cursor")).trim()).toBe(`2026-10-14T10:00:00.123456Z|${ID2}`);
    // Yeniden başlatma: DB yeni satır vermez → dosyaya hiçbir şey eklenmez; imleç psql değişkeni olarak geçer.
    const second = run(path.join(DIR, "error-watch.sh"), [], env, bin);
    expect(second.code).toBe(0);
    expect(read(path.join(dir, "hatalar.jsonl")).trim().split("\n")).toHaveLength(2);
    expect(read(path.join(dir, "psql.log"))).toContain(`cts=2026-10-14T10:00:00.123456Z -v cid=${ID2}`);
  });

  it("eski saniye biçimli imleç o saniyenin sonuna yuvarlanır; bozuk imleç 'şimdi'den başlar", () => {
    const { dir, bin } = fakeBin("ew-legacy");
    writeFileSync(path.join(dir, "hatalar.cursor"), "2026-10-14T10:00:00Z\n");
    run(path.join(DIR, "error-watch.sh"), [], { FAKE_DIR: dir, ERROR_WATCH_OUT_DIR: dir, ERROR_WATCH_ONCE: "1" }, bin);
    expect(read(path.join(dir, "psql.log"))).toContain("cts=2026-10-14T10:00:00.999999Z -v cid=ffffffff-ffff-ffff-ffff-ffffffffffff");
    writeFileSync(path.join(dir, "hatalar.cursor"), "x'; drop table t; --\n");
    run(path.join(DIR, "error-watch.sh"), [], { FAKE_DIR: dir, ERROR_WATCH_OUT_DIR: dir, ERROR_WATCH_ONCE: "1" }, bin);
    expect(read(path.join(dir, "psql.log"))).not.toContain("drop table");
    expect(read(path.join(dir, "psql.log"))).toContain("cid=00000000-0000-0000-0000-000000000000");
  });

  it("sorgu aynı µs'deki satırları id ile ayırır, aynı id'yi ikinci kez döndürmez", async () => {
    const db = new PGlite();
    await db.exec(`create table public.error_logs (id uuid primary key, source text, digest text, path text, message text,
      stack text, occurrences int default 1, last_seen timestamptz, resolved_at timestamptz, status text default 'open');`);
    const ts = "2026-10-14T10:00:00.123456Z";
    await db.query("insert into public.error_logs (id, message, last_seen) values ($1, 'a', $3), ($2, 'b', $3)", [ID1, ID2, ts]);
    const sql = heredoc("error-watch.sh", "poll_errors() {");
    const q = async (cts: string, cid: string) =>
      (await db.query<{ id: string }>(bind(sql, { cts, cid }))).rows.map((r) => r.id);
    expect(await q("2026-10-14T10:00:00.000000Z", "00000000-0000-0000-0000-000000000000")).toEqual([ID1, ID2]);
    expect(await q(ts, ID1)).toEqual([ID2]);
    expect(await q(ts, ID2)).toEqual([]);
    // Yeniden görülen hata (last_seen ilerler) yeni satır üretir.
    await db.query("update public.error_logs set last_seen = last_seen + interval '1 microsecond' where id = $1", [ID1]);
    expect(await q(ts, ID2)).toEqual([ID1]);
  });
});

describe("release.sh: migration başarısızsa yayın durur", () => {
  it("db:migrate 3 ile düşerse betik 3 ile biter; sürüm işareti, deploy ve push yapılmaz", () => {
    const { dir, bin } = fakeBin("rel", {
      npm: `#!/usr/bin/env bash\necho "npm $*" >> "$FAKE_DIR/calls.log"\ncase "$*" in *db:migrate*) echo "Hata: kasıtlı bozuk migration"; exit 3 ;; esac\nexit 0\n`,
      git: `#!/usr/bin/env bash\necho "git $*" >> "$FAKE_DIR/calls.log"\nexit 0\n`,
    });
    const repo = path.join(dir, "repo");
    mkdirSync(path.join(repo, "scripts/sunucu"), { recursive: true });
    copyFileSync(path.join(DIR, "release.sh"), path.join(repo, "scripts/sunucu/release.sh"));
    writeFileSync(path.join(repo, "scripts/sunucu/deploy.sh"), `echo DEPLOY_CALLED >> "$FAKE_DIR/calls.log"\n`);
    writeFileSync(path.join(repo, ".env.production"), "RELEASE_MIGRATION=x\nRELEASE_MIGRATION_CHECKSUM=y\n");
    const r = run(path.join(repo, "scripts/sunucu/release.sh"), [], { FAKE_DIR: dir, SKIP_GATE: "1" }, bin, repo);
    expect(r.code).toBe(3);
    expect(r.out).toContain("Migration başarısız (çıkış kodu 3)");
    const calls = read(path.join(dir, "calls.log"));
    expect(calls).toContain("npm run -s db:migrate");
    expect(calls).not.toContain("check:migrations");
    expect(calls).not.toContain("DEPLOY_CALLED");
    expect(calls).not.toContain("git push");
    expect(read(path.join(repo, ".env.production"))).toContain("RELEASE_MIGRATION=x");
  });
});

describe("rollback.sh --dry-run", () => {
  function rollback(args: string[], name: string, opts: { imageRc?: string; psqlOut?: string } = {}) {
    const { dir, bin } = fakeBin(name);
    const repo = path.join(dir, "repo");
    mkdirSync(path.join(repo, "scripts/sunucu"), { recursive: true });
    copyFileSync(path.join(DIR, "rollback.sh"), path.join(repo, "scripts/sunucu/rollback.sh"));
    writeFileSync(path.join(dir, "psql-out"), opts.psqlOut ?? "BEGIN\n202610141107-62e14a2e\nROLLBACK\n");
    const r = run(path.join(repo, "scripts/sunucu/rollback.sh"), args, {
      FAKE_DIR: dir, FAKE_IMAGE: "emlaksoft-app:202610141340-65ed9f68", FAKE_PSQL_OUT: path.join(dir, "psql-out"),
      FAKE_IMAGE_RC: opts.imageRc ?? "0", ROLLBACK_LOCK_DIR: dir, FAKE_TAGS: "202610141340-65ed9f68 202610141107-62e14a2e",
    }, bin, repo);
    return { ...r, calls: read(path.join(dir, "calls.log")), psql: read(path.join(dir, "psql.log")) };
  }

  it("bir önceki ok sürümü bulur, imajı doğrular, hedefi ve komutu yazar; hiçbir şey değiştirmez", () => {
    const r = rollback(["--dry-run"], "rb-dry");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Yayındaki sürüm : emlaksoft-app:202610141340-65ed9f68");
    expect(r.out).toContain("Hedef imaj      : emlaksoft-app:202610141107-62e14a2e");
    expect(r.out).toContain("Komut           : APP_TAG=202610141107-62e14a2e docker compose -f deploy/compose.prod.yml up -d --remove-orphans");
    expect(r.calls).toContain("docker image inspect emlaksoft-app:202610141107-62e14a2e");
    expect(r.calls).not.toContain("compose");
    expect(r.calls).not.toContain("docker create");
    expect(r.psql).toContain("begin read only");
    expect(r.psql).toContain("cur=202610141340-65ed9f68");
    expect(r.psql).not.toMatch(/insert into/i);
  });

  it("imaj yerelde yoksa 1 ile durur", () => {
    const r = rollback(["--dry-run"], "rb-missing", { imageRc: "1" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("Hedef imaj yerelde yok");
  });

  it("geçmişte önceki ok sürüm yoksa 1 ile durur; geçersiz etiket 2", () => {
    expect(rollback(["--dry-run"], "rb-none", { psqlOut: "BEGIN\nROLLBACK\n" }).code).toBe(1);
    expect(rollback(["--dry-run", "latest;rm"], "rb-bad").code).toBe(2);
  });

  it("açık etiketle hedef doğrudan alınır", () => {
    const r = rollback(["--dry-run", "202610141022-92354e17"], "rb-explicit");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Hedef imaj      : emlaksoft-app:202610141022-92354e17");
  });
});

describe("host-metrics.sh: konteyner JSON'u her zaman geçerli", () => {
  it("docker hata verince containers '[]' olur", () => {
    const { dir, bin } = fakeBin("hm");
    const r = run(path.join(DIR, "host-metrics.sh"), ["--print"], { FAKE_DIR: dir }, bin);
    expect(r.code).toBe(0);
    const lines = r.out.trim().split("\n");
    expect(JSON.parse(lines[lines.length - 1])).toEqual([]);
    expect(JSON.parse(lines[0]).cpu_count).toBeGreaterThan(0);
  });
});

describe("deploy.sh: prune_images son ok sürümleri korur", () => {
  it("release_history'den son iki ok etiketi ve yayındaki imaj silinmez", () => {
    const src = readFileSync(path.join(DIR, "deploy.sh"), "utf8");
    const fn = src.slice(src.indexOf("prune_images() {"), src.indexOf("\n}\n", src.indexOf("prune_images() {")));
    expect(fn).toContain("outcome = 'ok' order by finished_at desc, id desc limit 2");
    expect(fn).toContain("grep -qxF");
    expect(fn).toContain("{{.Config.Image}}");
  });
});

const SHELLCHECK = process.env.SHELLCHECK || (spawnSync("shellcheck", ["--version"]).status === 0 ? "shellcheck" : "");
describe.skipIf(!SHELLCHECK)("shellcheck", () => {
  it("sunucu betikleri temiz", () => {
    const files = ["error-watch.sh", "cron-call.sh", "release.sh", "deploy.sh", "rollback.sh", "host-metrics.sh"]
      .map((f) => path.join(DIR, f));
    const r = spawnSync(SHELLCHECK, files, { encoding: "utf8" });
    expect(r.stdout + r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
