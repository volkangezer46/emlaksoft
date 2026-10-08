import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NOTIFY_DEFAULTS } from "@/lib/settings/registry/tenant";
import { authorityReminderStep, authorityReminderTitle } from "@/lib/property-authority-reminders-core";

/**
 * SÖZLEŞME (anket sistemi + eksik bildirimler, PB49): kaynak taraması (DB/ağ yok). Yeni kuralın sessizce bozulmasını
 * engeller: migration güvenlik kalıpları, bildirim tercih anahtarlarının 4 yerde eş olması, devir/ödeme/yetki
 * bildirimlerinin TEK YOL `notifyTenant` (assignment-notify) üzerinden ve tek seferlik anahtarla gitmesi, yeni cron yok.
 */

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const MIG = "supabase/migrations/20261007000400_survey_matrix_channels.sql";

describe("PB49 migration", () => {
  const sql = read(MIG).toLowerCase();

  it("dosya + rollback var; pencere verisinde kayıtlı", () => {
    expect(existsSync(path.join(root, "supabase/rollbacks/20261007000400_survey_matrix_channels.rollback.sql"))).toBe(true);
    expect(read("scripts/migration-pairs-data.ts")).toContain("20261007000400_survey_matrix_channels.sql");
  });

  it("yeni olay/kitle/etiket CHECK'leri (enum ADD VALUE yok)", () => {
    expect(sql).not.toMatch(/alter type .* add value/);
    for (const v of ["'rent_renewal'", "'tenant_annual'", "'advisor_pulse'", "'advisor'"]) expect(sql).toContain(v);
    expect(sql).toContain("survey_questions_tag_check check (tag in ('primary','reason','advisor'))");
  });

  it("RPC'ler JWT kimlikli DEFINER, search_path boş, anon'a kapalı", () => {
    for (const fn of ["survey_close_low_score(uuid, text)", "survey_submit_advisor_pulse(uuid, text, jsonb)"]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated, service_role;`);
    }
    expect((sql.match(/security definer\s+set search_path = ''/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("public.current_tenant_id()");
  });

  it("ekip nabzı anonim: cevap satırı kişiye bağlanmaz, yazma politikası yok", () => {
    expect(sql).toContain("alter table public.survey_pulse_responses enable row level security");
    expect(sql).not.toMatch(/create policy \w+ on public\.survey_pulse_responses\s+for (insert|update|delete|all)/);
    const insert = sql.slice(sql.indexOf("insert into public.survey_tasks ("), sql.indexOf("returning id into v_task_id"));
    expect(insert).toContain("null, null, 'completed'"); // agent_id, assigned_to
    expect(insert).toContain("gen_random_uuid()::text"); // rastgele olay anahtarı
    expect(insert).toContain("date_trunc('day', now()), null, null"); // completed_at günlük, completed_by/created_by null
  });

  it("guard: zincir/gönderim sütunları anketöre kapalı, düşük puan yalnız notla kapanır", () => {
    expect(sql).toContain("old.escalation_level, old.sent_via, old.sent_at, old.send_attempts");
    expect(sql).toContain("char_length(btrim(coalesce(new.low_score_note, ''))) < 10");
  });
});

describe("bildirim tercih anahtarları 4 yerde eş", () => {
  const notify = read("src/lib/notify.ts");
  const union = notify.slice(notify.indexOf("export type NotifPrefKey"), notify.indexOf(";", notify.indexOf("export type NotifPrefKey")));
  const keys = [...union.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]!);
  const panel = read("src/components/app/notification-prefs.tsx");
  const action = read("src/app/actions/notification-prefs.ts");

  it("NotifPrefKey ⊆ panel satırları ⊆ action varsayılanları ⊆ ofis varsayılanları", () => {
    expect(keys).toEqual(expect.arrayContaining(["support", "assignment", "authority", "survey"]));
    const ids = NOTIFY_DEFAULTS.map((n) => n.id);
    for (const k of keys) {
      expect(panel, `panel satırı: ${k}`).toContain(`{ key: "${k}"`);
      expect(action, `action varsayılanı: ${k}`).toMatch(new RegExp(`\\b${k}: (true|false|prefs\\.)`));
      expect(ids, `ofis varsayılanı: ${k}`).toContain(k);
    }
  });

  it("kanal kapalı uyarısı ayarlar ve hesabım ekranına bağlı", () => {
    expect(panel).toContain("kanalı kapalı");
    expect(read("src/app/app/ayarlar/_sekmeler/bildirim-tab.tsx")).toContain("loadNotificationChannels(tenantId)");
    expect(read("src/app/app/hesabim/page.tsx")).toContain("loadNotificationChannels(auth.tenantId)");
  });
});

describe("eksik bildirimler bağlı (TEK YOL + tek seferlik anahtar)", () => {
  const wiring: [string, string, string][] = [
    ["src/app/actions/customers.ts", "export async function bulkAssignCustomers", "customer-bulk-assign:"],
    ["src/app/actions/customers.ts", "export async function reassignCustomer", "customer-assign:"],
    ["src/app/actions/properties.ts", "export async function reassignProperty", "property-assign:"],
    ["src/app/actions/team.ts", "export async function handoffMemberWorkload", "team-handoff:"],
    ["src/app/actions/appointments.ts", "export async function createAppointment", "appt-assigned:"],
    ["src/lib/billing/payment-link-fulfill.ts", "async function notifyPaymentLinkPaid", "plink-paid:"],
  ];
  for (const [file, marker, key] of wiring) {
    it(`${path.basename(file)} · ${marker.split(" ").pop()}`, () => {
      const src = read(file);
      const start = src.indexOf(marker);
      expect(start, marker).toBeGreaterThan(-1);
      const next = src.indexOf("\nexport ", start + marker.length);
      const fn = src.slice(start, next === -1 ? undefined : next);
      expect(fn).toContain("notifyAssignment(");
      expect(fn).toContain(key);
    });
  }

  it("toplu ve portföy devrinde hedef danışman ofisin aktif kullanıcısı olarak doğrulanır", () => {
    const customers = read("src/app/actions/customers.ts");
    const bulk = customers.slice(customers.indexOf("export async function bulkAssignCustomers"), customers.indexOf("export async function bulkDeleteCustomers"));
    expect(bulk).toMatch(/\.eq\("is_active", true\)/);
    const props = read("src/app/actions/properties.ts");
    const re = props.slice(props.indexOf("export async function reassignProperty"));
    expect(re.slice(0, re.indexOf("\nexport "))).toMatch(/\.eq\("is_active", true\)/);
  });

  it("yetki bitimi ve düşük puan zinciri mevcut cron'lara adım (yeni cron yok)", () => {
    expect(read("src/app/api/cron/abonelik-kontrol/route.ts")).toContain("runPropertyAuthorityReminders(admin");
    expect(read("src/app/api/cron/gorev-hatirlat/route.ts")).toContain("runLowScoreEscalation(admin");
    expect(read("src/app/api/cron/anket-gorevleri/route.ts")).toContain("dispatchSurveyLinks(admin");
    expect(existsSync(path.join(root, "src/app/api/cron/anket-gonder"))).toBe(false);
  });

  it("otomatik anket gönderimi İYS iznine, 30 gün kişi sınırına ve iyimser kilide bağlı", () => {
    const d = read("src/lib/surveys/dispatch.ts");
    // İzin kararı merkezi İYS kapısından gelir (kanal bazlı; granted + geri alınmamış kuralı gate.ts'te).
    expect(d).toContain('from "@/lib/iys/gate"');
    expect(d).toContain('kind: "survey"');
    expect(read("src/lib/iys/gate.ts")).toContain('row.status === "granted"');
    expect(d).toContain("CONTACT_COOLDOWN_DAYS");
    expect(d).toContain('.eq("send_attempts", t.send_attempts)');
    expect(d).not.toMatch(/createAdminClient\(|from "@\/lib\/supabase\/admin"/);
  });
});

describe("portföy yetkisi hatırlatma kademeleri", () => {
  it("30 / 7 / 0 gün pencereleri; 3 günden eski bitiş ve 30 günden uzak tarih yok", () => {
    expect(authorityReminderStep("2026-11-06", "2026-10-07")).toBe("30");
    expect(authorityReminderStep("2026-10-15", "2026-10-07")).toBe("30");
    expect(authorityReminderStep("2026-10-14", "2026-10-07")).toBe("7");
    expect(authorityReminderStep("2026-10-07", "2026-10-07")).toBe("0");
    expect(authorityReminderStep("2026-10-04", "2026-10-07")).toBe("0");
    expect(authorityReminderStep("2026-10-03", "2026-10-07")).toBeNull();
    expect(authorityReminderStep("2026-11-07", "2026-10-07")).toBeNull();
    expect(authorityReminderStep(null, "2026-10-07")).toBeNull();
    expect(authorityReminderTitle("0", "P-1 Daire", -2)).toContain("doldu");
    expect(authorityReminderTitle("7", "P-1 Daire", 5)).toContain("5 gün");
  });
});
