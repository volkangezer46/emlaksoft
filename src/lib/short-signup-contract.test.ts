import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/billing/plans";
import { defaultTeamSizeForPlan, registrationPlanForTeamSize } from "@/lib/billing/registration-plan";
import { maxTotalSeats } from "@/lib/billing/seat-pricing";
import { registrationQuote, registrationSelection } from "@/lib/billing/seat-calculator-model";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("kısa kayıt (TEK ekran, 4 alan) sözleşmesi", () => {
  const form = read("src/app/kayit/register-form.tsx");

  it("kayıttan çıkan alanlar formda yok; ofis adı, plan ve onay kutusu sorulmaz", () => {
    for (const gone of ["GeoSelect", "FIELD.provinceId", "FIELD.licenseNo", "FIELD.officePhone", "FIELD.logo", "FIELD.inviteEmails", "FIELD.workDistricts"]) {
      expect(form, gone).not.toContain(gone);
    }
    expect(form).not.toContain('name="company"');
    expect(form).not.toContain('name="legal_consent"');
    expect(form).not.toContain("PlanPicker");
    expect(form).not.toContain("const STEPS");
  });

  it("dört alan: ad soyad, cep telefonu (PhoneInput), e-posta (EmailInput), şifre (göster/gizle + güç göstergesi)", () => {
    expect(form).toContain('id="name"');
    expect(form).toContain("<PhoneInput");
    expect(form).toContain("<EmailInput");
    expect(form).toContain('autoComplete="new-password"');
    expect(form).toContain("<PasswordStrengthMeter");
    expect(form).toContain("Şifreyi göster");
    expect(form).toContain("Ücretsiz başla");
    expect(form).toContain("Giriş yap");
    expect(form).toContain("/sifre-sifirla");
  });

  it("plan yalnız fiyat sayfasından açık seçimle taşınır (gizli alan); varsayılan plan sunucudadır", () => {
    expect(form).toContain('name="plan" value={initialPlan}');
    expect(form).toContain("{initialPlan ? (");
    const page = read("src/app/kayit/_lib/register-page-data.tsx");
    expect(page).toContain("params.plan ? normalizePlanId(params.plan) : undefined");
  });

  it("paket seçici kayıttan çıktı: ortak bileşen olarak kurulum sihirbazında ve /app/abonelik'te", () => {
    expect(read("src/app/app/baslangic/plan-step.tsx")).toContain("PlanExplorer");
    expect(read("src/app/app/abonelik/plan-advisor-panel.tsx")).toContain("PlanExplorer");
    expect(read("src/components/billing/plan-explorer.tsx")).toContain('import("./plan-picker")');
  });

  it("paket seçici: LazyMotion m.*, reduced-motion, sahte rakam yok (tutar motordan)", () => {
    const picker = read("src/components/billing/plan-picker.tsx");
    // Hareket katmanı kuralı: motion yalnız src/components/ui/motion altında (RiseIn/GrowBar = LazyMotion m.*).
    expect(picker).toContain('from "@/components/ui/motion/grow"');
    expect(read("src/components/ui/motion/grow.tsx")).toContain("MotionProvider");
    expect(picker).toContain("useReducedMotion");
    expect(picker).toContain("registrationQuote(");
    expect(picker).toContain("AnimatedNumber");
    expect(picker).not.toMatch(/₺\s*\d{3,}|\d{3,}\s*₺(?!\))/); // sabit fiyat yok
    expect(picker).toContain("kart gerekmez");
    expect(picker).toContain("ödeme anında değiştirebilirsin");
  });

  it("sunucu sözleşmesi: sihirbaz alanları opsiyonel okunur, ofis adı varsayılanı '<Ad Soyad> Emlak', cep zorunlu", () => {
    const core = read("src/lib/registration/provision-office.ts");
    expect(core).toContain("readWizardOfficeProfile(formData");
    const auth = read("src/app/actions/auth.ts");
    expect(auth).toContain("`${fullName} Emlak`");
    expect(auth).toContain('"Cep telefonu zorunlu."');
    expect(auth).not.toContain("legal_consent");
  });
});

describe("paket seçimi: kullanıcı seçimine saygı, kapasite kuralı", () => {
  it("seçilen planın ekip kovası, sunucuda seçilen planı korur (aşağı düşürmez)", () => {
    for (const p of PLANS.filter((x) => !x.hidden)) {
      const bucket = defaultTeamSizeForPlan(p.id);
      expect(registrationPlanForTeamSize(p.id, bucket)).toBe(p.id);
    }
  });

  it("kapasiteyi karşılamayan paket quote.maxSeatsExceeded ile işaretlenir; motor önerisi bunu seçmez", () => {
    const visible = PLANS.filter((p) => !p.hidden);
    const huge = 400;
    const sel = registrationSelection(visible, undefined, huge, "monthly");
    const q = registrationQuote(visible, undefined, sel.planId, huge, "monthly");
    expect(q?.maxSeatsExceeded).toBe(false);
    // Paket seçicinin "taşımaz" işareti tam olarak kapasite sınırından gelir (sabit kural yok).
    for (const p of visible) {
      const quote = registrationQuote(visible, undefined, p.id, huge, "monthly");
      expect(quote?.maxSeatsExceeded, p.id).toBe(huge > maxTotalSeats(p));
    }
  });
});

describe("tek Kurulum sihirbazı sözleşmesi", () => {
  it("eski profil-tamamla adresi sihirbaza yönlenir, eski ?adim= değerleri eşlenir", () => {
    const page = read("src/app/app/ayarlar/profil-tamamla/page.tsx");
    expect(page).toContain('requireModulePage("dashboard")');
    expect(page).toContain("resolveLegacyStep(adim)");
    expect(page).toContain("/app/baslangic");
  });

  it("ofis adımı telefon/logo/geo mevcut yoldan; profil action'ları yetki kapılı", () => {
    const a = read("src/app/actions/profile-complete.ts");
    expect((a.match(/requirePermission\("settings", "edit"\)/g) ?? []).length).toBe(2);
    const office = read("src/app/app/baslangic/office-step.tsx");
    expect(office).toContain("saveOfficeProfile");
    expect(office).toContain("uploadTenantLogo");
    expect(office).toContain("GeoSelect");
    expect(read("src/app/actions/onboarding-setup.ts")).toContain("parsePhoneStrict");
    expect(read("src/app/app/baslangic/team-step.tsx")).toContain("PhoneInput"); // davet: createAdvisor -> parsePhoneStrict
    const wiz = read("src/app/actions/onboarding-wizard.ts");
    expect((wiz.match(/requirePermission\(/g) ?? []).length).toBe(2);
  });

  it("ana ekranda TEK Başlangıç kartı, tek ilerleme halkası; şirket/profil ayrıntısı göstermez", () => {
    const page = read("src/app/app/page.tsx");
    expect(page).toContain("<BaslangicKarti ctx={ctx} />");
    expect(page).not.toMatch(/ProfilTamamla|KurulumSeridi|DuyuruSatiri|OrnekVeriYenileBandi|HizliAksiyonlar/);
    const card = read("src/app/app/_home/baslangic-karti.tsx");
    expect(card).toContain("state.percent");
    expect(card).toContain("snap.firstTasks");
    expect(card).not.toContain("profile.completion");
    expect(card).not.toContain("profileStepHref");
  });

  it("adım listesi tek kayıtta; her kayıtlı adımın gövdesi var ya da href'i var", () => {
    const steps = read("src/lib/onboarding-steps.ts");
    expect(steps).toContain("ONBOARDING_STEP_DEFS");
    const bodies = read("src/app/app/baslangic/step-bodies.tsx");
    for (const id of ["office", "you", "team", "pool", "portals", "plan"]) {
      expect(steps, id).toContain(`id: "${id}"`);
      expect(bodies, id).toContain(`${id}:`);
    }
    expect(bodies).toContain("FallbackBody");
  });
});
