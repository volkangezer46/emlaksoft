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
      read -r -a rcs <<< "\${FAKE_CURL_RCS:-}"
      printf '%s' "\${codes[$((n - 1))]:-200}"; exit "\${rcs[$((n - 1))]:-0}"
    fi
    if has psql "$@"; then
      input=$(cat)
      printf -- '--ARGS %s\\n%s\\n' "$*" "$input" >> "$FAKE_DIR/psql.log"
      if [ -n "\${FAKE_PSQL_MIG_OUT:-}" ] && [[ "$input" == *"select coalesce(release_migration"* ]]; then
        cat "$FAKE_PSQL_MIG_OUT"
      elif [ -n "\${FAKE_PSQL_OUT:-}" ]; then cat "$FAKE_PSQL_OUT"; fi
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
  function cronCall(codes: string, name: string, curlRcs = "") {
    const { dir, bin } = fakeBin(name);
    writeFileSync(path.join(dir, "env"), "CRON_SECRET=test-secret\n");
    const r = run(path.join(DIR, "cron-call.sh"), ["/api/cron/ornek-is"], {
      FAKE_DIR: dir, FAKE_CODES: codes, FAKE_CURL_RCS: curlRcs, CRON_ENV_FILE: path.join(dir, "env"), CRON_LOCK_DIR: dir,
      CRON_RETRY_DELAY: "0",
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

  it("bağlantı yok (000, curl 7) sonra 200 → bir yeniden deneme", () => {
    const r = cronCall("000 200", "cc-conn", "7 0");
    expect(r.code).toBe(0);
    expect(r.curls).toBe(2);
    expect(r.psql).toBe("");
  });

  it("503 iki kez → tam bir yeniden deneme, cron_heartbeats'e error satırı", () => {
    const r = cronCall("503 503 503", "cc-fail");
    expect(r.code).toBe(1);
    expect(r.curls).toBe(2);
    expect(r.psql).toContain("insert into public.cron_heartbeats");
    expect(r.psql).toContain("job=ornek-is");
    expect(r.psql).toContain("detail=HTTP 503 (çağrı)");
    expect(r.psql).toContain("'error'");
  });

  it("500 → yeniden DENENMEZ (rota kısmi ilerlemiş olabilir), hata nabzı yazılır", () => {
    const r = cronCall("500 200", "cc-500");
    expect(r.code).toBe(1);
    expect(r.curls).toBe(1);
    expect(r.out).not.toContain("yeniden denenecek");
    expect(r.psql).toContain("detail=HTTP 500 (çağrı)");
  });

  it("zaman aşımı (000, curl 28) → yeniden DENENMEZ, 'zaman aşımı' nabzı yazılır", () => {
    const r = cronCall("000 200", "cc-timeout", "28 0");
    expect(r.code).toBe(1);
    expect(r.curls).toBe(1);
    expect(r.out).toContain("zaman aşımı; yeniden denenmedi");
    expect(r.psql).toContain("detail=zaman aşımı (çağrı, ");
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

describe("release.sh: SK1 yayın güvenliği (prova, RLS kapısı, PostgREST izleyicileri, tüm dosyalar ledger'da)", () => {
  const NPM = `#!/usr/bin/env bash
echo "npm $*" >> "$FAKE_DIR/calls.log"
case "$*" in
  *db:rehearse*) echo "[FAIL] 2-uygula kasıtlı bozuk"; exit "\${FAKE_REHEARSE_RC:-0}" ;;
  *db:rls-audit*) echo "[POLITIKA-YOK] 1 bulgu"; exit "\${FAKE_RLS_RC:-0}" ;;
  *db:migrate*) echo "tamam"; exit "\${FAKE_MIGRATE_RC:-0}" ;;
  *check:migrations*) printf 'RELEASE_MIGRATION=20261016010300_x.sql\nRELEASE_MIGRATION_CHECKSUM=abcdef0123456789\nRELEASE_MIGRATION_COUNT=451\n' ;;
esac
exit 0
`;
  function release(name: string, env: Record<string, string> = {}) {
    const { dir, bin } = fakeBin(name, {
      npm: NPM,
      git: `#!/usr/bin/env bash\necho "git $*" >> "$FAKE_DIR/calls.log"\nexit 0\n`,
    });
    const repo = path.join(dir, "repo");
    mkdirSync(path.join(repo, "scripts/sunucu"), { recursive: true });
    copyFileSync(path.join(DIR, "release.sh"), path.join(repo, "scripts/sunucu/release.sh"));
    writeFileSync(path.join(repo, "scripts/sunucu/deploy.sh"), `echo DEPLOY_CALLED >> "$FAKE_DIR/calls.log"\necho '{"ok":true}'\n`);
    writeFileSync(path.join(repo, ".env.production"), "RELEASE_MIGRATION=x\nRELEASE_MIGRATION_CHECKSUM=y\n");
    const r = run(path.join(repo, "scripts/sunucu/release.sh"), [], { FAKE_DIR: dir, SKIP_GATE: "1", ...env }, bin, repo);
    return { ...r, calls: read(path.join(dir, "calls.log")), psql: read(path.join(dir, "psql.log")), env: read(path.join(repo, ".env.production")) };
  }

  it("bozuk migration provada yakalanır: gerçek migrate, RLS, izleyici kapatma ve deploy YOK", () => {
    const r = release("rel-rehearse", { FAKE_REHEARSE_RC: "1" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("Migration provası başarısız");
    expect(r.calls).toContain("npm run -s db:rehearse -- --yes-i-understand-locks --pending");
    expect(r.calls).not.toContain("db:migrate");
    expect(r.calls).not.toContain("db:rls-audit");
    expect(r.calls).not.toContain("DEPLOY_CALLED");
    expect(r.psql).not.toContain("disable");
  });

  it("RLS ihlali gerçek migration'dan ÖNCE durdurur; RLS_GATE=warn bilinçli geçiştir", () => {
    const r = release("rel-rls", { FAKE_RLS_RC: "1" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("RLS denetimi başarısız — yayın durduruldu");
    expect(r.calls.indexOf("db:rls-audit")).toBeGreaterThan(r.calls.indexOf("db:rehearse"));
    expect(r.calls).not.toContain("db:migrate");
    const w = release("rel-rls-warn", { FAKE_RLS_RC: "1", RLS_GATE: "warn" });
    expect(w.code).toBe(0);
    expect(w.calls).toContain("db:migrate");
  });

  it("migrate düşerse çıkış kodu korunur ve izleyiciler tuzakla yeniden AÇILIR; reload NOTIFY'ı gönderilir", () => {
    const r = release("rel-trap", { FAKE_MIGRATE_RC: "3" });
    expect(r.code).toBe(3);
    const off = r.psql.indexOf("alter event trigger pgrst_ddl_watch disable");
    const on = r.psql.indexOf("alter event trigger pgrst_ddl_watch enable");
    expect(off).toBeGreaterThan(-1);
    expect(on).toBeGreaterThan(off);
    expect(r.psql).toContain("alter event trigger pgrst_drop_watch enable");
    expect(r.psql.slice(on)).toContain("notify pgrst, 'reload schema'");
    expect(r.calls).not.toContain("check:migrations");
  });

  it("başarılı yayın: tüm dosyalar ledger'da denetimi, sayım .env.production'a eklenir, NOTIFY deploy'a bırakılır", () => {
    const r = release("rel-ok");
    expect(r.code).toBe(0);
    expect(r.calls).toContain("npm run -s check:migrations -- --database --release");
    expect(r.env).toContain("RELEASE_MIGRATION=20261016010300_x.sql");
    expect(r.env).toContain("RELEASE_MIGRATION_CHECKSUM=abcdef0123456789");
    expect(r.env).toContain("RELEASE_MIGRATION_COUNT=451");
    expect(r.calls).toContain("DEPLOY_CALLED");
    expect(r.calls).toContain("git push");
    expect(r.psql).not.toContain("notify pgrst");
    expect(r.psql.indexOf("pgrst_ddl_watch enable")).toBeGreaterThan(r.psql.indexOf("pgrst_ddl_watch disable"));
  });
});

describe("deploy.sh: mavi/yeşil geçiş ve bekçi (SK1/B043, B179)", () => {
  const SWAP_DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_DIR/calls.log"
bad() { case " \${FAKE_UNHEALTHY:-} " in *" $1 "*) return 0 ;; esac; return 1; }
case "$1" in
  inspect)
    if [[ "$*" == *Labels* ]]; then [ -n "\${FAKE_LABEL_DIFF:-}" ] && echo "traefik.eski=1"; exit 0; fi
    if bad "$2"; then echo starting; else echo healthy; fi; exit 0 ;;
  exec) if [ "$3" = node ] && bad "$2"; then exit 1; fi; exit 0 ;;
esac
exit 0
`;
  /** deploy.sh'teki geçiş + bekçi tanımları (COMPOSE= … static up öncesi) + sürücü. */
  function harness(name: string, driver: string, env: Record<string, string> = {}, extra: Record<string, string> = {}) {
    const src = readFileSync(path.join(DIR, "deploy.sh"), "utf8");
    const defs = src.slice(src.indexOf("COMPOSE=(docker compose"), src.indexOf('"${COMPOSE[@]}" up -d --no-deps static'));
    const { dir, bin } = fakeBin(name, extra);
    writeFileSync(path.join(bin, "docker"), SWAP_DOCKER);
    const script = path.join(dir, "h.sh");
    writeFileSync(script, `set -euo pipefail\n${defs}\n${driver}\n`);
    const r = run(script, [], { FAKE_DIR: dir, DRAIN_WAIT: "0", SETTLE_WAIT: "0", READY_TRIES: "2", ...env }, bin);
    return { ...r, dir, calls: read(path.join(dir, "calls.log")) };
  }

  it("sıra: yeşil yeni etiketle açılır → mavi boşaltılır → mavi yeni etiketle kurulur → yeşil boşaltılıp kaldırılır", () => {
    const r = harness("swap-ok", 'set +e; swap_to T1; echo "RC=$?"');
    expect(r.out).toContain("RC=0");
    const c = r.calls;
    const order = [
      "docker compose -f deploy/compose.prod.yml --profile green up -d --no-deps app-green",
      "docker exec emlaksoft-app sh -c : > /tmp/emlaksoft-drain",
      "docker compose -f deploy/compose.prod.yml up -d --no-deps app",
      "docker exec emlaksoft-app-green sh -c : > /tmp/emlaksoft-drain",
      "docker compose -f deploy/compose.prod.yml --profile green rm -sf app-green",
    ].map((s) => c.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("yeşil sağlıklı olmazsa mavi HİÇ boşaltılmaz/yeniden kurulmaz (eski sürüm kesintisiz yayında), kod 1", () => {
    const r = harness("swap-green-bad", 'set +e; swap_to T1; echo "RC=$?"', { FAKE_UNHEALTHY: "emlaksoft-app-green" });
    expect(r.out).toContain("RC=1");
    expect(r.calls).not.toContain("docker exec emlaksoft-app sh -c");
    expect(r.calls).not.toContain("up -d --no-deps app\n");
    expect(r.calls).toContain("rm -sf app-green");
  });

  it("Traefik etiketleri değiştiyse (ilk yayın) yeşil AÇILMAZ (Traefik çakışması); mavi tek seferlik yeniden kurulur", () => {
    const r = harness("swap-labels", 'set +e; swap_to T1; echo "RC=$?"', { FAKE_LABEL_DIFF: "1" });
    expect(r.out).toContain("RC=0");
    expect(r.out).toContain("Traefik etiketleri değişti");
    expect(r.calls).not.toContain("app-green");
    expect(r.calls).toContain("docker compose -f deploy/compose.prod.yml up -d --no-deps app");
  });

  it("mavi yeniden kurulamazsa kod 2 (yeşil trafikte kalır, kaldırılmaz)", () => {
    const r = harness("swap-blue-bad", 'set +e; swap_to T1; echo "RC=$?"', { FAKE_UNHEALTHY: "emlaksoft-app" });
    expect(r.out).toContain("RC=2");
    expect(r.calls).not.toContain("emlaksoft-app-green sh -c");
  });

  function watch(name: string, streak: string, e2eRc: string, measureRc: string, env: Record<string, string> = {}) {
    const extra = {
      npm: `#!/usr/bin/env bash\necho "npm $*" >> "$FAKE_DIR/calls.log"\nexit ${e2eRc}\n`,
      npx: `#!/usr/bin/env bash\necho "npx $*" >> "$FAKE_DIR/calls.log"\necho "BÜTÇE: ölçüm"\nexit ${measureRc}\n`,
    };
    const state = path.join(tmp, `${name}-seri`);
    writeFileSync(state, streak);
    const r = harness(name, 'set +e; watchdog; echo "WRC=$?"', { WATCHDOG_STATE: state, ...env }, extra);
    return { ...r, streak: read(state).trim() };
  }

  it("bekçi: yeşil seriyi artırır; 3 yeşile kadar kırmızı yalnız uyarı; sonra geri dönüş; ölçülemedi (3) nötr", () => {
    expect(watch("wd-green", "1", "0", "0")).toMatchObject({ streak: "2" });
    expect(watch("wd-green", "1", "0", "0").out).toContain("WRC=0");
    const warn = watch("wd-warn", "2", "0", "1");
    expect(warn.out).toContain("WRC=0");
    expect(warn.out).toContain("yalnız uyarı");
    expect(warn.streak).toBe("0");
    const back = watch("wd-back", "3", "1", "0");
    expect(back.out).toContain("WRC=1");
    expect(back.out).toContain("public smoke kırık");
    expect(watch("wd-forced-warn", "5", "0", "1", { WATCHDOG: "warn" }).out).toContain("WRC=0");
    const neutral = watch("wd-neutral", "2", "0", "3");
    expect(neutral.out).toContain("WRC=0");
    expect(neutral.streak).toBe("2");
    expect(neutral.calls).toContain("npm run -s test:e2e:public");
    expect(neutral.calls).toContain("npx tsx scripts/perf/measure-live.mts --watchdog --json");
  });
});

describe("rollback.sh --dry-run", () => {
  function rollback(
    args: string[],
    name: string,
    opts: { imageRc?: string; psqlOut?: string; migOut?: string; envMig?: string } = {},
  ) {
    const { dir, bin } = fakeBin(name);
    const repo = path.join(dir, "repo");
    mkdirSync(path.join(repo, "scripts/sunucu"), { recursive: true });
    copyFileSync(path.join(DIR, "rollback.sh"), path.join(repo, "scripts/sunucu/rollback.sh"));
    writeFileSync(path.join(dir, "psql-out"), opts.psqlOut ?? "BEGIN\n202610141107-62e14a2e\nROLLBACK\n");
    const mig: Record<string, string> = {};
    if (opts.migOut !== undefined) {
      writeFileSync(path.join(dir, "mig-out"), opts.migOut);
      mig.FAKE_PSQL_MIG_OUT = path.join(dir, "mig-out");
    }
    if (opts.envMig) writeFileSync(path.join(repo, ".env.production"), `X=1\nRELEASE_MIGRATION=${opts.envMig}\n`);
    const r = run(path.join(repo, "scripts/sunucu/rollback.sh"), args, {
      FAKE_DIR: dir, FAKE_IMAGE: "emlaksoft-app:202610141340-65ed9f68", FAKE_PSQL_OUT: path.join(dir, "psql-out"),
      FAKE_IMAGE_RC: opts.imageRc ?? "0", ROLLBACK_LOCK_DIR: dir, FAKE_TAGS: "202610141340-65ed9f68 202610141107-62e14a2e",
      ROLLBACK_STATIC_DIR: path.join(dir, "yok"), ROLLBACK_HEALTH_URL: `file://${path.join(dir, "psql-out")}`,
      ...mig,
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

  it("hedefin migration'ı DB'dekinden farklıysa 'Şema notu' basar ve 3 ile durur (sorgu stdin'den, -c değil)", () => {
    const r = rollback(["--dry-run"], "rb-schema", {
      migOut: "BEGIN\n20261014022000_alert_engine_pulse_rule.sql\nROLLBACK\n",
      envMig: "20261014025000_platform_tenant_onboarding_facts.sql",
    });
    expect(r.code).toBe(3);
    expect(r.out).toContain("Şema notu       : hedef 20261014022000_alert_engine_pulse_rule.sql ile yayınlanmıştı");
    expect(r.out).toContain("DB 20261014025000_platform_tenant_onboarding_facts.sql'de kalır");
    // psql -c değişken yerleştirmez: sorgu stdin'den, t değişkeniyle gitmeli.
    expect(r.psql).toMatch(/--ARGS [^\n]*-v t=202610141107-62e14a2e[^\n]*\n[^]*where tag = :'t'/);
    expect(r.psql).not.toMatch(/--ARGS [^\n]* -c /);
    expect(r.calls).not.toContain("compose");
  });

  it("hedefin migration'ı DB ile aynıysa şema notu yok, kuru çalışma 0", () => {
    const r = rollback(["--dry-run"], "rb-schema-same", {
      migOut: "BEGIN\n20261014025000_platform_tenant_onboarding_facts.sql\nROLLBACK\n",
      envMig: "20261014025000_platform_tenant_onboarding_facts.sql",
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("Şema notu");
  });

  it("hedef migration sorgusu gerçek SQL'de çalışır (pglite)", async () => {
    const db = new PGlite();
    await db.exec(`create table public.release_history (id bigserial primary key, tag text, outcome text,
      finished_at timestamptz not null default now(), release_migration text);
      insert into public.release_history (tag, outcome, finished_at, release_migration) values
        ('202610141107-62e14a2e', 'ok', now() - interval '2 hour', '20261014022000_a.sql'),
        ('202610141107-62e14a2e', 'failed', now() - interval '1 hour', '20261014029000_x.sql'),
        ('202610141340-65ed9f68', 'ok', now(), '20261014025000_b.sql');`);
    const sql = heredoc("rollback.sh", "TARGET_MIG=").replace(/^begin read only;|^rollback;/gm, "");
    const rows = (await db.query<Record<string, string>>(bind(sql, { t: "202610141107-62e14a2e" }))).rows;
    expect(rows.map((r) => Object.values(r)[0])).toEqual(["20261014022000_a.sql"]);
  });

  it("gerçek dönüş (sahte docker): compose hedef etiketle, latest hedefe taşınır, rolled_back yazılır", () => {
    const r = rollback([], "rb-real");
    expect(r.code).toBe(0);
    expect(r.calls).toContain("docker compose -f deploy/compose.prod.yml up -d --remove-orphans");
    expect(r.calls).toContain("docker tag emlaksoft-app:202610141107-62e14a2e emlaksoft-app:latest");
    expect(r.psql).toContain("outcome=rolled_back");
    expect(r.psql).toMatch(/insert into public\.release_history/);
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
