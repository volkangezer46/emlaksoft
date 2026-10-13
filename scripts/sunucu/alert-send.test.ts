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
