import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Sunucu uyarı göndericisi (alert-send.py) + error-watch.sh "bildirildi mi" kararı.
 * Canlıya DOKUNMAZ: betik modül olarak yüklenir; psql (DB), post_json (ağ), read_env (.env.production) ve önbellek
 * yolu geçici sahtelerle değiştirilir. DB'ye yazılamaması (record → stderr) senaryosu özellikle sınanır.
 */
const DIR = path.join(process.cwd(), "scripts/sunucu");
const SCRIPT = path.join(DIR, "alert-send.py");
const tmp = mkdtempSync(path.join(tmpdir(), "alert-send-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const HARNESS = `
import importlib.util, json, sys
cfg = json.loads(sys.argv[1])
spec = importlib.util.spec_from_file_location("alert_send", cfg["script"])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.CACHE_DIR = cfg["tmp"]; m.CACHE = cfg["tmp"] + "/cache.json"
json.dump(cfg["state"], open(m.CACHE, "w"))
def psql(sql, variables=None, timeout=15): raise RuntimeError("DB yok (test)")
m.psql = psql
m.read_env = lambda: {}
sent = []
def post_json(url, payload, headers=None, timeout=8):
    sent.append({"url": url, "payload": payload}); return cfg["ok"], "HTTP 200" if cfg["ok"] else "HTTP 500"
m.post_json = post_json
code = m.main(cfg["argv"])
print("@@SENT " + json.dumps(sent))
sys.exit(code)
`;
writeFileSync(path.join(tmp, "harness.py"), HARNESS);

const telegram = { id: "c1", kind: "telegram", name: "Ops", sealed: JSON.stringify({ kind: "telegram", botToken: "1:abc", chatId: "42" }) };
const baseState = { channels: [telegram], rule: { enabled: true, threshold: 2, repeat_minutes: 15, muted_until: null }, email: {} };

function run(argv: string[], opts: { ok?: boolean; state?: unknown } = {}) {
  const r = spawnSync("python3", ["-I", "-B", path.join(tmp, "harness.py"), JSON.stringify({ script: SCRIPT, tmp, argv, ok: opts.ok ?? true, state: opts.state ?? baseState })], {
    encoding: "utf8",
  });
  const sentLine = r.stdout.split("\n").find((l) => l.startsWith("@@SENT ")) ?? "@@SENT []";
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, sent: JSON.parse(sentLine.slice(7)) as { url: string; payload: { event: string } }[] };
}

describe("alert-send.py", () => {
  it("DB'ye yazılamasa da (stderr) iletildiyse çıkış kodu 0", () => {
    const r = run(["fire", "--title", "Site yanıt vermiyor", "--body", "x"]);
    expect(r.stderr).toContain("alert_events yazılamadı");
    expect(r.stdout.startsWith("gönderildi")).toBe(true);
    expect(r.code).toBe(0);
    expect(r.sent).toHaveLength(1);
  });

  it("iletilemezse çıkış kodu 3; kural sessizse gönderim yok", () => {
    expect(run(["fire", "--title", "T", "--body", "x"], { ok: false }).code).toBe(3);
    const muted = run(["fire", "--title", "T", "--body", "x"], { state: { ...baseState, rule: { ...baseState.rule, muted_until: "2999-01-01T00:00:00Z" } } });
    expect(muted.code).toBe(3);
    expect(muted.sent).toHaveLength(0);
  });

  it("resolve: yalnız uyarı bildirildiyse düzeldi gider", () => {
    expect(run(["resolve", "--notified", "1", "--title", "T", "--body", "x"]).sent).toHaveLength(1);
    expect(run(["resolve", "--notified", "0", "--title", "T", "--body", "x"]).sent).toHaveLength(0);
  });

  it("hatırlatma [SÜRÜYOR] önekiyle ve 'reminder' olayıyla gider", () => {
    const r = run(["fire", "--reminder", "1", "--title", "Site yanıt vermiyor", "--body", "x"]);
    expect(r.code).toBe(0);
    expect(r.sent[0]!.payload).toMatchObject({ text: expect.stringContaining("[SÜRÜYOR]") });
  });

  it("rule tekrar aralığını da yazdırır (sınır dışı → 30)", () => {
    expect(run(["rule"]).stdout.split("\n")[0]).toBe("1 2 0 15");
    expect(run(["rule"], { state: { ...baseState, rule: { ...baseState.rule, repeat_minutes: 1 } } }).stdout.split("\n")[0]).toBe("1 2 0 30");
  });

  it("webhook: iç ağ adresi gönderilmeden reddedilir", () => {
    const hook = { id: "w1", kind: "webhook", name: "Hook", sealed: JSON.stringify({ kind: "webhook", url: "https://127.0.0.1/x", secret: null }) };
    const r = run(["fire", "--title", "T", "--body", "x"], { state: { ...baseState, channels: [hook] } });
    expect(r.sent).toHaveLength(0);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain("Webhook reddedildi");
  });

  it("is_blocked_host ve yönlendirme reddi (Node isBlockedWebhookHost ile aynı yön)", () => {
    const code = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location("a", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
blocked = ["localhost", "x.internal", "supabase-db", "127.0.0.1", "10.0.0.5", "169.254.169.254", "192.168.1.1", "172.16.0.1", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]
assert all(m.is_blocked_host(h) for h in blocked), [h for h in blocked if not m.is_blocked_host(h)]
assert not m.is_blocked_host("8.8.8.8")
assert not m.webhook_url_ok("http://8.8.8.8/x") and not m.webhook_url_ok("https://8.8.8.8:22/x") and m.webhook_url_ok("https://8.8.8.8/x")
assert m._NoRedirect().redirect_request(None, None, 302, "Found", {}, "http://127.0.0.1/") is None
print("ok")
`;
    const r = spawnSync("python3", ["-I", "-B", "-c", code, SCRIPT], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.stdout.trim()).toBe("ok");
  });
});

describe("error-watch.sh alert_call", () => {
  // Betiğin kendi alert_call işlevi çıkarılır; sahte ALERT önce stderr'e yazar (DB hatası), sonra stdout'a.
  const watch = readFileSync(path.join(DIR, "error-watch.sh"), "utf8");
  const fn = watch.match(/^alert_call\(\) \{[\s\S]*?^\}/m)?.[0] ?? "";

  function decide(exitCode: number) {
    const fake = path.join(tmp, `fake-${exitCode}.py`);
    writeFileSync(fake, `import sys\nprint("alert_events yazılamadı: DB yok", file=sys.stderr, flush=True)\nprint("${exitCode === 0 ? "gönderildi" : "gönderilmedi"}: Telegram")\nsys.exit(${exitCode})\n`);
    const sh = `ALERT=${JSON.stringify(fake)}\nALERT_ERR=${JSON.stringify(path.join(tmp, "err.log"))}\n${fn}\nalert_call fire --title T\necho "SENT=$SENT RES=$RES"`;
    return spawnSync("bash", ["-c", sh], { encoding: "utf8" }).stdout.trim();
  }

  it("stderr gürültüsüne rağmen karar çıkış kodundan: iletildi → SENT=1", () => {
    expect(fn).not.toBe("");
    expect(decide(0)).toBe("SENT=1 RES=gönderildi: Telegram");
    expect(decide(3)).toBe("SENT=0 RES=gönderilmedi: Telegram");
    expect(readFileSync(path.join(tmp, "err.log"), "utf8")).toContain("alert_events yazılamadı");
  });
});

describe("alert-send.py engine-check (uyarı motoru nabzı, simülasyon)", () => {
  // DB yazımları yakalanır (alert_events insert/update = "uyarı olayı oluştu"); önbellek okuması DB'siz kalır.
  const ENGINE_HARNESS = `
import importlib.util, json, sys
cfg = json.loads(sys.argv[1])
spec = importlib.util.spec_from_file_location("alert_send", cfg["script"])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.CACHE_DIR = cfg["tmp"]; m.CACHE = cfg["tmp"] + "/engine-cache.json"; m.ENGINE_STATE = cfg["tmp"] + "/engine-watch.json"
json.dump(cfg["state"], open(m.CACHE, "w"))
calls = []
def psql(sql, variables=None, timeout=15):
    if "public.alert_events" in sql:
        # Olay satırı açılışı "insert into public.alert_events", düzeliş "update public.alert_events"; ikisi de B114 ile
        # aynı ifadede personel zili (platform_notifications) yazar.
        calls.append({"op": "insert" if "insert into public.alert_events" in sql else "update", "vars": variables,
                      "staffBell": "insert into public.platform_notifications" in sql}); return ""
    raise RuntimeError("DB yok (test)")
m.psql = psql
m.read_env = lambda: {}
m.now_epoch = lambda: cfg["now"]
sent = []
def post_json(url, payload, headers=None, timeout=8):
    sent.append({"url": url, "payload": payload}); return True, "HTTP 200"
m.post_json = post_json
code = m.main(cfg["argv"])
print("@@SENT " + json.dumps(sent))
print("@@CALLS " + json.dumps(calls))
sys.exit(code)
`;
  const dir = mkdtempSync(path.join(tmpdir(), "engine-check-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, "harness.py"), ENGINE_HARNESS);
  const engineState = { ...baseState, rules: { engine_stalled: { enabled: true, threshold: 20, repeat_minutes: 60, muted_until: null } } };
  const stateFile = path.join(dir, "engine-watch.json");

  function check(ageSec: number, nowSec: number, opts: { state?: unknown; enabled?: "0" | "1" } = {}) {
    const argv = ["engine-check", "--age-sec", String(ageSec), ...(opts.enabled ? ["--engine-enabled", opts.enabled] : [])];
    const r = spawnSync(
      "python3",
      ["-I", "-B", path.join(dir, "harness.py"), JSON.stringify({ script: SCRIPT, tmp: dir, argv, now: nowSec, state: opts.state ?? engineState })],
      { encoding: "utf8" },
    );
    const pick = (tag: string) => JSON.parse(r.stdout.split("\n").find((l) => l.startsWith(`@@${tag} `))?.slice(tag.length + 3) ?? "[]");
    const line = r.stdout.split("\n").find((l) => l && !l.startsWith("@@")) ?? "";
    return {
      code: r.status,
      line,
      stderr: r.stderr,
      sent: pick("SENT") as { payload: { text?: string } }[],
      calls: pick("CALLS") as { op: string; vars: Record<string, string>; staffBell?: boolean }[],
    };
  }

  it("nabız eşik altında: olay yok, satır yok", () => {
    rmSync(stateFile, { force: true });
    const r = check(10 * 60, 1_000_000);
    expect(r.code).toBe(0);
    expect(r.line).toBe("");
    expect(r.sent).toHaveLength(0);
    expect(r.calls).toHaveLength(0);
  });

  it("nabız kesilince uyarı satırı + host olayı; tekrar aralığında hatırlatma; dönünce düzeldi", () => {
    rmSync(stateFile, { force: true });
    const t0 = 2_000_000;
    const fire = check(25 * 60, t0);
    expect(fire.code).toBe(0);
    expect(fire.line.startsWith("MOTOR DURDU: gönderildi")).toBe(true);
    expect(fire.sent).toHaveLength(1);
    expect(fire.sent[0]!.payload.text).toContain("[UYARI] Uyarı motoru durdu");
    expect(fire.calls).toEqual([expect.objectContaining({ op: "insert", vars: expect.objectContaining({ rule: "engine_stalled", fp: "engine_stalled" }) })]);
    // B114: kritik olay kanal olsa da olmasa da süper admin + operasyon ziline aynı ifadede yazılır (hatırlatma değil).
    expect(fire.calls[0]).toMatchObject({ staffBell: true, vars: { reminder: "0" } });
    expect(JSON.parse(readFileSync(stateFile, "utf8"))).toMatchObject({ alerted: true, notified: true });

    // Aynı kesinti, tekrar aralığı (60 dk) dolmadan: yeni gönderim yok.
    expect(check(35 * 60, t0 + 10 * 60).sent).toHaveLength(0);
    // Aralık doldu: [SÜRÜYOR] hatırlatması.
    const reminder = check(90 * 60, t0 + 61 * 60);
    expect(reminder.line.startsWith("MOTOR SÜRÜYOR")).toBe(true);
    expect(reminder.sent[0]!.payload.text).toContain("[SÜRÜYOR]");
    // Hatırlatma zile ikinci kez yazılmaz (SQL koşulu: reminder = '0').
    expect(reminder.calls[0]).toMatchObject({ vars: { reminder: "1" } });

    const resolved = check(2 * 60, t0 + 70 * 60);
    expect(resolved.line.startsWith("MOTOR DÜZELDİ: gönderildi")).toBe(true);
    expect(resolved.sent[0]!.payload.text).toContain("[DÜZELDİ]");
    expect(resolved.calls[0]).toMatchObject({ op: "update", vars: { fp: "engine_stalled", label: "Sorun" }, staffBell: true });
    expect(JSON.parse(readFileSync(stateFile, "utf8"))).toMatchObject({ alerted: false });
  });

  it("motor ayardan kapalıysa ya da kural kapalıysa uyarı üretilmez", () => {
    rmSync(stateFile, { force: true });
    expect(check(999 * 60, 3_000_000, { enabled: "0" }).sent).toHaveLength(0);
    const off = { ...engineState, rules: { engine_stalled: { enabled: false, threshold: 20, repeat_minutes: 60, muted_until: null } } };
    const r = check(999 * 60, 3_000_000, { state: off });
    expect(r.sent).toHaveLength(0);
    expect(r.calls).toHaveLength(0);
  });

  it("kural satırı yoksa kod varsayılanı (20 dk / 60 dk); health_down eski önbellek biçimiyle okunur", () => {
    rmSync(stateFile, { force: true });
    expect(check(19 * 60, 4_000_000, { state: baseState }).sent).toHaveLength(0);
    expect(check(21 * 60, 4_000_060, { state: baseState }).sent).toHaveLength(1);
    expect(run(["rule", "--rule", "engine_stalled"]).stdout.split("\n")[0]).toBe("1 20 0 60");
    expect(run(["rule"]).stdout.split("\n")[0]).toBe("1 2 0 15");
  });
});

describe("error-watch.sh engine_check", () => {
  const watch = readFileSync(path.join(DIR, "error-watch.sh"), "utf8");
  const fn = watch.match(/^engine_check\(\) \{[\s\S]*?^\}/m)?.[0] ?? "";

  it("özet satırı JSONL'e 'uyari-motoru' yoluyla yazılır; boş çıktı satır yazmaz", () => {
    expect(fn).not.toBe("");
    expect(watch).toMatch(/TICK % 4\)\) = 2 \]; then engine_check/);
    const out = path.join(tmp, "hatalar.jsonl");
    for (const [i, msg] of [["a", "MOTOR DURDU: gönderildi: Telegram iletildi"], ["b", ""]] as const) {
      const fake = path.join(tmp, `engine-${i}.py`);
      writeFileSync(fake, `print(${JSON.stringify(msg)}, end="")\n`);
      const sh = `ALERT=${JSON.stringify(fake)}\nALERT_ERR=${JSON.stringify(path.join(tmp, "err.log"))}\nOUT=${JSON.stringify(out)}\n${fn}\nengine_check`;
      spawnSync("bash", ["-c", sh], { encoding: "utf8" });
    }
    const lines = readFileSync(out, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ kaynak: "uyari", yol: "uyari-motoru", mesaj: "MOTOR DURDU: gönderildi: Telegram iletildi" });
  });
});
