import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";
import { SIGNUP_FIELD_STEP, signupErrorTarget, signupFieldInputId, signupPhoneClientError } from "./signup-errors";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("kayıt sihirbazı: hata -> adım eşlemesi", () => {
  it("hata yoksa hedef yok", () => {
    expect(signupErrorTarget({})).toEqual({ kind: "none" });
    expect(signupErrorTarget(null)).toEqual({ kind: "none" });
    expect(signupErrorTarget({ error: "  " })).toEqual({ kind: "none" });
  });

  it("telefon/e-posta/şifre hatası 1. adıma, ofis adı ve onay (kısa kayıt) 2. adıma döner", () => {
    expect(signupErrorTarget({ error: TR_MOBILE_ERROR_MESSAGE, field: "phone" })).toEqual({
      kind: "field",
      field: "phone",
      step: 1,
      message: TR_MOBILE_ERROR_MESSAGE,
    });
    expect(signupErrorTarget({ error: "Bu e-posta zaten kayıtlı.", field: "email" })).toMatchObject({ step: 1, field: "email" });
    expect(signupErrorTarget({ error: "x", field: "password" })).toMatchObject({ step: 1 });
    expect(signupErrorTarget({ error: "x", field: "company" })).toMatchObject({ step: 2 });
    expect(signupErrorTarget({ error: "x", field: "legal_consent" })).toMatchObject({ step: 2 });
  });

  it("alanla eşleşmeyen hata genel banda gider (metin taranmaz)", () => {
    expect(signupErrorTarget({ error: "Çok fazla kayıt denemesi." })).toEqual({ kind: "general", message: "Çok fazla kayıt denemesi." });
    // Metninde 'telefon' geçse de alan bilgisi yoksa adım değişmez.
    expect(signupErrorTarget({ error: "Geçerli bir cep telefonu girin" }).kind).toBe("general");
    expect(signupErrorTarget({ error: "x", field: "bilinmeyen" }).kind).toBe("general");
  });

  it("her alanın odak id'si formda var", () => {
    const form = read("src/app/kayit/register-form.tsx");
    for (const f of Object.keys(SIGNUP_FIELD_STEP) as (keyof typeof SIGNUP_FIELD_STEP)[]) {
      expect(form).toContain(`id="${signupFieldInputId(f)}"`);
      expect(form).toContain(`data-field="${f}"`);
    }
  });
});

describe("kayıt sihirbazı: istemci telefon ön doğrulaması", () => {
  it("boş telefon serbest (opsiyonel)", () => {
    expect(signupPhoneClientError("")).toBeNull();
    expect(signupPhoneClientError(undefined)).toBeNull();
  });
  it("TR cep geçer", () => {
    expect(signupPhoneClientError("05321234567")).toBeNull();
  });
  it("sabit hat veya yabancı numara TR cep uyarısı alır", () => {
    expect(signupPhoneClientError("02121234567")).toBe(TR_MOBILE_ERROR_MESSAGE);
    expect(signupPhoneClientError("+4915123456789")).toBe(TR_MOBILE_ERROR_MESSAGE);
  });
  it("eksik numara hata verir", () => {
    expect(signupPhoneClientError("0532")).toBeTruthy();
  });
});

describe("kayıt sözleşmesi: sunucu alan hatası döner, form sıfırlanmaz", () => {
  const auth = read("src/app/actions/auth.ts");
  const fn = auth.slice(auth.indexOf("export async function signUp"));
  it("telefon ve e-posta hataları field taşır", () => {
    expect(fn).toMatch(/PHONE_ERROR_MESSAGE, field: "phone"/);
    expect(fn).toMatch(/TR_MOBILE_ERROR_MESSAGE, field: "phone"/);
    expect(fn).toMatch(/EMAIL_ERROR_MESSAGE, field: "email"/);
    expect(fn).toMatch(/zaten kayıtlı\.", field: "email"/);
  });
  it("form action'ı otomatik sıfırlamasız gönderilir ve eski metin-tarama eşlemesi yok", () => {
    const form = read("src/app/kayit/register-form.tsx");
    expect(form).toContain("onSubmit={handleSubmit}");
    expect(form).not.toContain("action={action}");
    expect(form).not.toContain("errorStep(");
  });
});
