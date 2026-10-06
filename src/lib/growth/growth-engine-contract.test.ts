import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GROWTH_RPC, SETTINGS_KEYS } from "./engine";
import { GROWTH_FLAGS_OFF, GROWTH_SETTING_KEYS } from "./settings";
import { CRON_JOBS } from "@/lib/cron-jobs";

/**
 * SÖZLEŞME: referans/ortak motoru (20260826000600) SQL'i <-> TS (engine.ts / program.ts) ve kanca/yetki/allowlist kuralları.
 * Saf dosya taraması (DB yok). İşlevsel doğrulama: growth-engine-sql-exec.test.ts (pglite varsa).
 */
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const SQL = read("supabase/migrations/20260826000600_growth_referral_engine.sql");
const ROLLBACK = read("supabase/rollbacks/20260826000600_growth_referral_engine.rollback.sql");

function fnStatement(name: string): string {
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i");
  const start = SQL.search(re);
  expect(start, `${name} bulunamadı`).toBeGreaterThanOrEqual(0);
  const rest = SQL.slice(start + 10);
  const next = rest.search(/create\s+or\s+replace\s+function\s+public\./i);
  return next < 0 ? SQL.slice(start) : SQL.slice(start, start + 10 + next);
}

function params(name: string): string[] {
  const m = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([^)]*)\\)`, "i").exec(SQL);
  if (!m) return [];
  return m[1]!
    .split(",")
    .map((p) => p.trim().split(/\s+/)[0]!)
    .filter(Boolean);
}

describe("RPC sözleşmesi: ad ve parametreler SQL ile BİREBİR", () => {
  const expected: Record<keyof typeof GROWTH_RPC, string[]> = {
    register: ["p_invoice"],
    welcome: ["p_referred"],
    process: ["p_limit"],
    reverse: ["p_invoice", "p_reason"],
    metrics: [],
    queue: ["p_status", "p_limit"],
    ready: [],
    myDashboard: [],
    myPartner: [],
    invitePreview: ["p_code"],
    decide: ["p_claim", "p_decision", "p_reason"],
    saveSettings: ["p_values"],
    payoutCreate: ["p_partner", "p_method", "p_document_no", "p_paid_at", "p_note"],
    partnerUpdate: ["p_partner", "p_values"],
  };
  for (const [key, ps] of Object.entries(expected)) {
    it(`${key}: ${GROWTH_RPC[key as keyof typeof GROWTH_RPC]}(${ps.join(", ")})`, () => {
      const name = GROWTH_RPC[key as keyof typeof GROWTH_RPC];
      expect(params(name)).toEqual(ps);
    });
  }

  it("ayar anahtarları growth_referral_settings sütunlarıyla aynı kümedir", () => {
    const table = /create table if not exists public\.growth_referral_settings \(([\s\S]*?)\n\);/.exec(SQL)![1]!;
    const cols = table
      .split("\n")
      .map((l) => /^\s{2}([a-z0-9_]+)\s+(boolean|numeric|int|text|uuid|timestamptz)/.exec(l)?.[1])
      .filter((c): c is string => Boolean(c) && !["singleton", "updated_by", "updated_at"].includes(c as string));
    expect([...cols].sort()).toEqual([...SETTINGS_KEYS].sort());
    const save = fnStatement("growth_admin_save_settings");
    for (const k of SETTINGS_KEYS) expect(save, k).toContain(`p_values ->> '${k}'`);
  });
});

describe("SQL: yetki, güvenlik, varsayılanlar", () => {
  const all = [...SQL.matchAll(/create\s+or\s+replace\s+function\s+public\.(growth_[a-z0-9_]+)/gi)].map((m) => m[1]!);

  it("her SECURITY DEFINER işlev search_path = '' sabitler", () => {
    for (const name of all) {
      const stmt = fnStatement(name);
      if (/security definer/i.test(stmt)) expect(stmt, name).toMatch(/set search_path = ''/i);
    }
    expect(all.length).toBeGreaterThanOrEqual(25);
  });

  it("service_role-only işlevler rolü doğrular", () => {
    for (const n of ["growth_claim_register", "growth_grant_welcome", "growth_claims_process", "growth_claims_reverse_for_invoice", "growth_admin_metrics", "growth_admin_queue"]) {
      expect(fnStatement(n), n).toContain("auth.role() is distinct from 'service_role'");
    }
  });

  it("personel RPC'leri DB içinde super_admin doğrular (service_role gerektirmez)", () => {
    for (const n of ["growth_admin_decide", "growth_admin_save_settings", "growth_admin_payout_create", "growth_admin_partner_update"]) {
      expect(fnStatement(n), n).toContain("growth_staff_super_admin()");
      expect(fnStatement(n), n).toContain("errcode = '42501'");
    }
    expect(fnStatement("growth_staff_super_admin")).toContain("ps.role = 'super_admin'");
  });

  it("tüm growth_* işlevleri önce kapatılır; yalnız beklenenler authenticated/anon'a açılır", () => {
    expect(SQL).toMatch(/revoke all on function %s from public, anon, authenticated/);
    const grants = [...SQL.matchAll(/grant execute on function public\.(growth_[a-z0-9_]+)\([^)]*\) to ([a-z, ]+);/g)].map((m) => `${m[1]}->${m[2]}`);
    expect(grants.sort()).toEqual(
      [
        "growth_my_dashboard->authenticated",
        "growth_my_partner_dashboard->authenticated",
        "growth_admin_decide->authenticated",
        "growth_admin_save_settings->authenticated",
        "growth_admin_payout_create->authenticated",
        "growth_admin_partner_update->authenticated",
        "growth_invite_preview->anon, authenticated",
      ].sort(),
    );
  });

  it("ofis okuma işlevleri yalnız KENDİ tenant'ını görür", () => {
    for (const n of ["growth_my_dashboard", "growth_my_partner_dashboard"]) {
      const s = fnStatement(n);
      expect(s).toContain("public.current_tenant_id()");
      expect(s).toMatch(/if v_tenant is null then\s+return null;/);
    }
    expect(fnStatement("growth_my_dashboard")).not.toMatch(/\bphone\b|\bemail\b|tax_number/i);
  });

  it("bayraklar varsayılan KAPALI: migration bayrak AÇMAZ, kural/ödül satırı EKLEMEZ", () => {
    expect(SQL).not.toMatch(/insert into public\.platform_settings/i);
    expect(SQL).not.toMatch(/insert into public\.growth_reward_rules/i);
    expect(SQL).not.toMatch(/insert into public\.growth_partners/i);
    expect(SQL).toMatch(/welcome_credit_try numeric\(12,2\) not null default 0 /);
    expect(GROWTH_FLAGS_OFF).toEqual({ referralEnabled: false, partnerEnabled: false, cashPayoutEnabled: false });
    expect(GROWTH_SETTING_KEYS.cashPayoutEnabled).toBe("growth_cash_payout_enabled");
  });

  it("KVKK: IP/cihaz izi saklanmaz", () => {
    expect(SQL).not.toMatch(/ip_hash|ip_address|user_agent|device_id|fingerprint/i);
  });

  it("odül: ilk gerçek ödeme + bekleme; demo/tam kredi/iade sayılmaz", () => {
    const real = fnStatement("growth_real_payment");
    expect(real).toContain("i.status <> 'paid'");
    expect(real).toContain("'demo'");
    expect(real).toContain("'account_credit'");
    expect(real).toContain("walletCashTry");
    expect(real).toContain("meta -> 'refund'");
    const reg = fnStatement("growth_register_referral");
    expect(reg).toContain("not_first_payment");
    expect(reg).toContain("make_interval(days => r.hold_days)");
    expect(reg).toContain("growth_flag_on('growth_referral_enabled')");
    // kayıt anında ödül yok: talep yalnız faturadan üretilir
    expect(fnStatement("growth_grant_welcome")).toContain("welcome_credit_try");
  });

  it("kötüye kullanım bayrakları: tenant, vergi no, telefon, kurumsal e-posta alan adı; genel sağlayıcılar hariç", () => {
    const f = fnStatement("growth_pair_flags");
    for (const k of ["same_tenant", "same_tax_no", "same_phone", "same_email_domain"]) expect(f).toContain(k);
    const dom = fnStatement("growth_public_email_domain");
    for (const d of ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "yandex.com"]) expect(dom).toContain(d);
    expect(fnStatement("growth_register_referral")).toContain("velocity");
  });

  it("kredi: try_credit_grant idempotent anahtarı claim'e bağlı, meta.claim_id, vade kuraldan", () => {
    const g = fnStatement("growth_grant_claim");
    expect(g).toContain("'ref-claim-' || c.id::text");
    expect(g).toContain("public.try_credit_grant(");
    expect(g).toContain("'claim_id', c.id::text");
    expect(g).toContain("credit_expires_days");
    expect(g).toContain("annual_cap_months");
    expect(g).toContain("monthly_cap_try");
    expect(g).toContain("referrer_inactive");
  });

  it("clawback: try_credit_reverse + p_original_idem (grant_idem) ve idempotent anahtar", () => {
    const c = fnStatement("growth_clawback_pending");
    expect(c).toContain("public.try_credit_reverse(");
    expect(c).toContain("c.grant_idem");
    expect(c).toContain("'ref-rev-' || c.id::text");
    expect(c).toContain("skip locked");
  });

  it("iade/iptal/chargeback tespiti: fatura, meta.refund, yakalama, abonelik iptali", () => {
    const p = fnStatement("growth_claims_process");
    expect(p).toContain("i.meta -> 'refund' is not null");
    expect(p).toContain("billing_payment_captures");
    expect(p).toContain("'refunded', 'refund_required'");
    expect(p).toContain("referred_cancelled");
    expect(p).toContain("try_credit_ready()");
  });

  it("kademe bonusu: tek sefer (tekil indeks) ve rozet depolanmaz", () => {
    expect(SQL).toContain("uq_growth_claims_tier_once");
    expect(SQL).toContain("uq_growth_claims_base_once");
    expect(SQL).toContain("uq_growth_claims_component");
    expect(SQL).not.toMatch(/alter table public\.growth_reward_claims[^;]*badge/i);
  });

  it("FAZ 2: komisyon yalnız ortak bayrağı açıkken; nakit ödeme ayrı bayrak + vergi mükellefi + belge no/tarih", () => {
    expect(fnStatement("growth_register_partner")).toContain("growth_flag_on('growth_partner_enabled')");
    const pay = fnStatement("growth_admin_payout_create");
    expect(pay).toContain("growth_flag_on('growth_partner_enabled')");
    expect(pay).toContain("growth_flag_on('growth_cash_payout_enabled')");
    expect(pay).toContain("not p.is_tax_payer");
    expect(pay).toContain("document_required");
    expect(pay).toContain("partner_min_payout_try");
    expect(pay).toContain("clawback_due");
    expect(SQL).toContain("check (status <> 'paid' or paid_at is not null)");
    expect(fnStatement("growth_claims_process")).toContain("growth_flag_on('growth_partner_enabled')");
  });

  it("karar RPC'si: neden zorunlu, yalnız inceleme kuyruğu onaylanır, aynı ofis onaylanamaz, kredi YAZMAZ", () => {
    const d = fnStatement("growth_admin_decide");
    expect(d).toContain("reason_required");
    expect(d).toContain("'same_tenant' = any (c.flags)");
    expect(d).not.toContain("try_credit_");
    expect(d).toContain("growth_log_event");
  });

  it("olay izi append-only", () => {
    expect(SQL).toContain("growth_claim_events append-only");
  });

  it("ön koşul bloğu, sıra ve geri alma dosyası", () => {
    expect(SQL).toContain("Once 20260825000800_growth_referral_partner_attribution.sql uygulanmali");
    expect(SQL).toContain("Once 20260826000400/000500");
    expect(SQL.split("\n")[0]).toContain("20260826000600_growth_referral_engine.sql");
    expect(SQL).toContain("UYGULANMADI");
    expect("20260826000600" > "20260826000500").toBe(true);
    for (const name of new Set([...SQL.matchAll(/create\s+or\s+replace\s+function\s+public\.(growth_[a-z0-9_]+)/gi)].map((m) => m[1]!))) {
      expect(ROLLBACK, name).toContain(`drop function if exists public.${name}(`);
    }
    expect(ROLLBACK).toContain("rollback_force");
  });
});

describe("kancalar: güvenli, ödemeyi/iadeyi/kaydı bozmaz", () => {
  const fulfillment = read("src/lib/billing/fulfillment.ts");
  it("fulfillment: transitionCapture 'fulfilled' SONRASI, return ÖNCESİ, yalnız abonelik hedefi", () => {
    const iDone = fulfillment.indexOf('await transitionCapture(captureId, "fulfilled")');
    const iHook = fulfillment.indexOf("await registerClaimSafe(admin, data.invoiceId)");
    const iRet = fulfillment.indexOf("...(data as AtomicFulfillmentResult)");
    expect(iDone).toBeGreaterThan(0);
    expect(iHook).toBeGreaterThan(iDone);
    expect(iRet).toBeGreaterThan(iHook);
    expect(fulfillment).toMatch(/input\.targetType === "subscription" && typeof data\.invoiceId === "string"/);
  });
  it("fulfill SQL gövdelerine DOKUNULMADI: yeni migration fulfill_billing_payment tanımlamaz", () => {
    expect(SQL).not.toMatch(/create\s+or\s+replace\s+function\s+public\.fulfill_billing_payment/i);
  });
  it("iade: kayıt yazıldıktan sonra talepler geri alınır", () => {
    const refund = read("src/app/actions/platform-billing.ts");
    const iUpd = refund.indexOf('action: "billing.invoice.refund_recorded"');
    const iHook = refund.indexOf('reverseClaimsForInvoiceSafe(admin, invoiceId, "invoice_refunded")');
    expect(iHook).toBeGreaterThan(0);
    expect(iHook).toBeLessThan(iUpd);
    expect(refund.indexOf('.is("meta->refund", null)')).toBeLessThan(iHook);
  });
  it("kayıt: hoş geldin kredisi yalnız davet atfı yazıldıktan sonra", () => {
    const store = read("src/lib/growth/store.ts");
    expect(store).toMatch(/if \(!error && refKind === "referral"\) await grantWelcomeSafe\(admin, tenantId\)/);
  });
  it("kanca sarmalayıcıları fırlatmaz (try/catch) ve motor yokken sessizdir", () => {
    const engine = read("src/lib/growth/engine.ts");
    for (const fn of ["registerClaimSafe", "reverseClaimsForInvoiceSafe", "grantWelcomeSafe"]) {
      const body = engine.slice(engine.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 900), fn).toMatch(/try \{[\s\S]*catch/);
    }
    expect(engine).toContain("isMissingRpc");
  });
});

describe("cron: growth-claims", () => {
  const route = read("src/app/api/cron/growth-claims/route.ts");
  it("CRON_SECRET Bearer + heartbeat + mevcut allowlist'li istemci (yeni createAdminClient yok)", () => {
    expect(route).toMatch(/authorizeCron|CRON_SECRET/);
    // Bearer doğrulaması ortak kapıdadır (authorizeCron -> cron-auth.ts).
    expect(route.includes("authorizeCron(") ? read("src/lib/cron-auth.ts") : route).toMatch(/Bearer \$\{(secret|expected)\}/);
    expect(route).toContain('recordHeartbeat("growth-claims"');
    expect(route).toContain("runBillingReconciliation(0, \"growth_claims\")");
    expect(route).not.toContain("=> processClaims");
    expect(route).not.toMatch(/createAdminClient\s*\(/);
  });
  it("vercel.json + cron-jobs.ts + route eşleşir", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const v = vercel.crons.find((c) => c.path === "/api/cron/growth-claims");
    const j = CRON_JOBS.find((c) => c.job === "growth-claims");
    expect(v).toBeDefined();
    expect(j?.schedule).toBe(v?.schedule);
    expect(j?.path).toBe("/api/cron/growth-claims");
    expect(existsSync(join(root, "src/app/api/cron/growth-claims/route.ts"))).toBe(true);
    expect(vercel.crons.length).toBe(CRON_JOBS.length);
  });
  it("reconciliation: yan iş modunda mutabakat ATLANIR (para hareketi yok)", () => {
    const rec = read("src/lib/billing/reconciliation.ts");
    const i = rec.indexOf(`if (job === "growth_claims") {`);
    expect(i).toBeGreaterThan(0);
    expect(rec).not.toContain("sideJob");
    expect(i).toBeLessThan(rec.indexOf('admin.rpc("claim_billing_payment_captures"'));
    expect(i).toBeLessThan(rec.indexOf('admin.rpc("expire_stale_billing_checkouts"'));
  });
  it("sayı belgelerde güncel", () => {
    const n = CRON_JOBS.length;
    expect(n).toBe(36);
    expect(read("CLAUDE.md")).toContain(`Cron:** ${n} route`);
    expect(read("docs/DURUM.md")).toContain(`| ${n} / ${n} |`);
    expect(read("docs/MIMARI.md")).toContain(`Cron envanteri (${n}`);
    expect(read("docs/HAFIZA.md")).toContain(`(${n} rota`);
  });
});

describe("service_role: yeni kullanım YOK, allowlist gevşetilmedi", () => {
  const NEW_FILES = [
    "src/lib/growth/engine.ts",
    "src/lib/growth/program.ts",
    "src/app/api/cron/growth-claims/route.ts",
    "src/components/app/referral-nudge.tsx",
    "src/components/app/referral-nudge-card.tsx",
    "src/app/kayit/invite-banner.tsx",
    "src/app/app/buyume/page.tsx",
    "src/app/admin/growth/page.tsx",
    "src/app/admin/growth/growth-forms.tsx",
  ];
  it("yeni/yeniden yazılan dosyalar createAdminClient çağırmaz", () => {
    for (const f of NEW_FILES) expect(read(f), f).not.toMatch(/createAdminClient\s*\(/);
  });
  it("yeni admin eylemleri personel OTURUMUYLA RPC çağırır, cüzdan yazıcılarını içe aktarmaz", () => {
    const a = read("src/app/actions/growth.ts");
    for (const fn of ["decideClaim", "saveReferralSettings", "updatePartnerDetails", "createPartnerPayout"]) {
      const body = a.slice(a.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 700), fn).toContain("guardPlatformAction(ADMIN_GATE)");
      expect(body.slice(0, 1800), fn).toContain("staffRpc(await createClient()");
    }
    expect(a).not.toMatch(/try-credits\/wallet/);
    expect(a).toContain("logPlatformActivity");
    // vergi numarası denetim kaydına yazılmaz
    expect(a).toMatch(/hasTaxNo: Boolean\(taxNo\)/);
    expect(a).not.toMatch(/meta: \{[^}]*tax_no/);
  });
  it("saveGrowthFlags: kapalıdan açığa geçişte hazırlık kontrolü zorunlu; nakit ortak programsız açılmaz", () => {
    const a = read("src/app/actions/growth.ts");
    expect(a).toContain("readinessBlockers(checks)");
    expect(a).toContain("Hazırlık kontrolü geçmedi");
    expect(a).toContain("Nakit ödeme yalnız ortak programı açıkken açılabilir.");
  });
});

describe("arayüz sözleşmesi", () => {
  const office = read("src/app/app/buyume/page.tsx");
  const admin = read("src/app/admin/growth/page.tsx");
  it("ofis panosu: sıfır çıkmaz metrik (her StatCard href'li), sabit tutar yok, /r/KOD bağlantısı", () => {
    const cards = office.match(/<StatCard\b/g)?.length ?? 0;
    const hrefs = office.match(/<StatCard\b[^>]*\bhref=/g)?.length ?? 0;
    expect(cards).toBeGreaterThanOrEqual(12);
    expect(hrefs).toBe(cards);
    expect(office).not.toMatch(/\d+\s*TL|%\s*\d+|ay ücretsiz|bedava/i);
    expect(office).toContain("buildShortInviteUrl(base, ov.code)");
    expect(office).toContain("TRY_WALLET_LINKS.wallet");
  });
  it("ofis panosu: davet durumları (denemede/bekliyor/ödül yüklendi/iptal), kademe ve rozet, filtre URL'i", () => {
    expect(office).toContain("tierProgress(d.paid, d.tiers)");
    expect(office).toContain("parseInviteFilter(sp.durum)");
    expect(office).toContain("filterInvites(d.invites, durum)");
    expect(office).toContain("Gizlilik gereği davet ettiğiniz ofislerin adı gösterilmez");
    // açık genel lider tablosu YOK
    expect(office + admin).not.toMatch(/lider tablosu|leaderboard/i);
  });
  it("ticari ileti kuralı: sunucu davetçi adına e-posta/SMS göndermez", () => {
    for (const f of ["src/lib/growth/engine.ts", "src/lib/growth/program.ts", "src/app/app/buyume/invite-panel.tsx", "src/app/actions/growth.ts"]) {
      expect(read(f), f).not.toMatch(/sendSms|sendEmail|netgsm|resend|nodemailer/i);
    }
    expect(office).toContain("EmlakSoft sizin adınıza e-posta veya SMS göndermez");
  });
  it("admin: ölçüm kartları tıklanabilir, hazırlık kontrolü ve kuyruk var", () => {
    const cards = admin.match(/<AdminStatCard\b/g)?.length ?? 0;
    const hrefs = admin.match(/<AdminStatCard\b[^>]*\bhref=/g)?.length ?? 0;
    // Tek huni yeniden tasarımı: üst şerit 4 kart, ölçüm hunisi/K-faktör/maliyet satırları <Link> ile süzgece gider
    // (eski 10 kartlık ızgara kaldırıldı). Her kart tıklanabilir kalır; her ölçüm satırı bir Link içindedir.
    expect(cards).toBeGreaterThanOrEqual(4);
    expect(hrefs).toBe(cards);
    expect(admin.match(/<Link\b[^>]*\bhref=\{(?:hrefFor|queueHref)\(/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
    for (const k of ["K-faktör", "CAC geri dönüşü", "Kötüye kullanım oranı", "Ödül maliyeti", "Deneme → ödeme dönüşümü", "Bağlantı tıklaması"]) {
      expect(admin + read("src/app/admin/growth/funnel-model.ts")).toContain(k);
    }
    expect(admin).toContain("ReadinessPanel");
    expect(admin).toContain('id="kuyruk"');
    expect(admin).toContain("ClaimActions");
  });
  it("istemci dosyaları: phone-rules STATİK içe aktarmaz, zaman doğrudan okunmaz, ham tel/e-posta girişi yok", () => {
    for (const f of [
      "src/app/app/buyume/invite-panel.tsx",
      "src/components/app/referral-nudge-card.tsx",
      "src/app/admin/growth/growth-forms.tsx",
      "src/app/kayit/invite-banner.tsx",
    ]) {
      const s = read(f);
      expect(s, f).not.toMatch(/phone-rules/);
      expect(s, f).not.toMatch(/Date\.now\(|new Date\(/);
      expect(s, f).not.toMatch(/type="(tel|email)"/);
    }
    expect(read("src/lib/growth/program.ts")).not.toMatch(/^import .*(zod|supabase|phone-rules)|Date\.now\(|new Date\(/m);
  });
  it("tetik anları: 4 sayfada gerçek koşula bağlı, kapatılabilir kart", () => {
    expect(read("src/app/app/anlasmalar/page.tsx")).toContain('<ReferralNudge moment="first_deal" show={(realWonRes.count ?? 0) >= 1} />');
    expect(read("src/app/app/degerleme/page.tsx")).toContain('<ReferralNudge moment="first_valuation" show={rows.length >= 1} />');
    expect(read("src/app/app/abonelik/page.tsx")).toContain('<ReferralNudge moment="credit_purchase" show={Boolean(sp.paid && packInvoiceRecent && packInvoice?.status === "paid")} />');
    expect(read("src/app/app/ekip/page.tsx")).toContain('<ReferralNudge moment="team_grew" show={activeCount >= 3} />');
    const server = read("src/components/app/referral-nudge.tsx");
    expect(server).toContain("flags.referralEnabled");
    expect(server).toContain('effectiveCanAccessModule(perms, "settings")');
    expect(read("src/components/app/referral-nudge-card.tsx")).toContain("Bu öneriyi kapat");
  });
  it("kayıt ekranı: davetle gelene 'X sizi davet etti' ve avantaj", () => {
    expect(read("src/app/kayit/page.tsx")).toContain("readInvitePreview(await createClient(), touch.code)");
    expect(read("src/app/kayit/register-form.tsx")).toContain("<InviteBanner invite={invite} />");
    expect(read("src/app/kayit/invite-banner.tsx")).toContain("sizi EmlakSoft&apos;a davet etti");
  });
});
