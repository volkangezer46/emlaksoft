import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/billing/plans";
import { defaultTeamSizeForPlan, registrationPlanForTeamSize } from "@/lib/billing/registration-plan";
import { maxTotalSeats } from "@/lib/billing/seat-pricing";
import { registrationQuote, registrationSelection } from "@/lib/billing/seat-calculator-model";
import { PROFILE_STEPS } from "@/lib/profile-completion";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("kısa kayıt (2 adım) sözleşmesi", () => {
  const form = read("src/app/kayit/register-form.tsx");

  it("kayıttan çıkan alanlar formda yok; uygulama içi sihirbaza taşındı", () => {
    for (const gone of ["GeoSelect", "FIELD.provinceId", "FIELD.licenseNo", "FIELD.officePhone", "FIELD.logo", "FIELD.inviteEmails", "FIELD.workDistricts"]) {
      expect(form, gone).not.toContain(gone);
    }
    expect(form).toContain("Ofis profilini tamamla");
    expect(form).toMatch(/const LAST = STEPS\.length/);
    expect(form.match(/no: \d,/g)).toHaveLength(2);
  });

  it("paket seçimi gizli plan/cycle/agents alanlarıyla gider; seçici dinamik yüklenir", () => {
    expect(form).toContain('name="plan" value={selectedPlanId}');
    expect(form).toContain('name="cycle" value={cycle}');
    expect(form).toContain('name="agents" value={agentsBucket}');
    expect(form).toContain('import("./plan-picker")');
    expect(form).toContain("wide={step === LAST}");
  });

  it("paket seçici: LazyMotion m.*, reduced-motion, sahte rakam yok (tutar motordan)", () => {
    const picker = read("src/app/kayit/plan-picker.tsx");
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

  it("sunucu sözleşmesi geriye uyumlu: sihirbaz alanları opsiyonel okunur", () => {
    const core = read("src/lib/registration/provision-office.ts");
    expect(core).toContain("readWizardOfficeProfile(formData");
    const auth = read("src/app/actions/auth.ts");
    expect(auth).toContain("Ad, e-posta, şifre ve firma adı zorunlu.");
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

describe("ofis profili sihirbazı sözleşmesi", () => {
  it("yeni action'lar requirePermission ile başlar; telefon/logo/ekip mevcut yoldan", () => {
    const a = read("src/app/actions/profile-complete.ts");
    expect((a.match(/requirePermission\("settings", "edit"\)/g) ?? []).length).toBe(2);
    const w = read("src/app/app/ayarlar/profil-tamamla/profil-sihirbaz.tsx");
    expect(w).toContain("saveOfficeProfile"); // parsePhoneStrict orada
    expect(w).toContain("uploadTenantLogo");
    expect(w).toContain("TeamStep"); // createAdvisor -> provisionTeamMember
    expect(w).toContain("PhoneInput");
    expect(read("src/app/actions/onboarding-setup.ts")).toContain("parsePhoneStrict");
  });

  it("sayfa yetki kapısı ve ana ekran kartı tek satırlık Suspense ile bağlı", () => {
    expect(read("src/app/app/ayarlar/profil-tamamla/page.tsx")).toContain('requireModulePage("settings"');
    expect(read("src/app/app/page.tsx")).toContain("<ProfilTamamla ctx={ctx} />");
  });

  it("her adımın sihirbazda gövdesi var", () => {
    const w = read("src/app/app/ayarlar/profil-tamamla/profil-sihirbaz.tsx");
    for (const s of PROFILE_STEPS) expect(w, s.key).toContain(`case "${s.key}"`.replace('case "ekip"', 'props.step === "ekip"'));
  });
});
