import { describe, expect, it } from "vitest";
import {
  detailOrList,
  errorNextStep,
  fieldAriaProps,
  fieldDescribedBy,
  resolveSubmitOutcome,
  type SubmitOptions,
} from "./form-logic";

type R = { ok?: boolean; error?: string; id?: string };

describe("fieldDescribedBy", () => {
  it("id yoksa undefined", () => {
    expect(fieldDescribedBy(undefined, true)).toBeUndefined();
  });
  it("hata varken hata paragrafını işaret eder", () => {
    expect(fieldDescribedBy("f", true)).toBe("f-error");
    expect(fieldDescribedBy("f", true, false)).toBe("f-error");
  });
  it("hata yokken yalnız ipucu varsa ipucunu işaret eder", () => {
    expect(fieldDescribedBy("f", false, true)).toBe("f-hint");
    expect(fieldDescribedBy("f", false, false)).toBeUndefined();
  });
});

describe("fieldAriaProps", () => {
  it("boş girdide yalnız id", () => {
    expect(fieldAriaProps({ id: "x" })).toEqual({ id: "x" });
    expect(fieldAriaProps({})).toEqual({});
  });
  it("zorunlu alan aria-required alır", () => {
    expect(fieldAriaProps({ id: "x", required: true })).toEqual({ id: "x", "aria-required": true });
  });
  it("hata varken aria-invalid + describedby=error", () => {
    expect(fieldAriaProps({ id: "x", error: "Zorunlu", hint: true })).toEqual({
      id: "x",
      "aria-invalid": true,
      "aria-describedby": "x-error",
    });
  });
  it("hata yokken ipucu varsa describedby=hint, aria-invalid yok", () => {
    const out = fieldAriaProps({ id: "x", hint: true });
    expect(out["aria-describedby"]).toBe("x-hint");
    expect(out["aria-invalid"]).toBeUndefined();
  });
  it("boş hata metni hata sayılmaz", () => {
    expect(fieldAriaProps({ id: "x", error: "" })["aria-invalid"]).toBeUndefined();
  });
});

describe("errorNextStep", () => {
  it("paket/limit hatasında abonelik bağlantısı verir", () => {
    expect(errorNextStep("Paket limitine ulaştınız.")?.href).toBe("/app/abonelik");
    expect(errorNextStep("Aylık KOTA doldu")?.href).toBe("/app/abonelik");
  });
  it("ilgisiz hata veya boş metinde null", () => {
    expect(errorNextStep("Geçerli bir tutar girin.")).toBeNull();
    expect(errorNextStep(null)).toBeNull();
    expect(errorNextStep(undefined)).toBeNull();
  });
});

describe("resolveSubmitOutcome", () => {
  const options: SubmitOptions<R> = {
    successMessage: "Kaydedildi",
    redirectTo: (r) => detailOrList("/app/x", r.id),
  };

  it("ok:true ise toast mesajı ve yönlendirme üretir", () => {
    expect(resolveSubmitOutcome<R>({ ok: true, id: "7" }, options)).toEqual({
      ok: true,
      message: "Kaydedildi",
      redirect: "/app/x/7",
    });
  });
  it("id yoksa liste adresine döner", () => {
    const out = resolveSubmitOutcome<R>({ ok: true }, options);
    expect(out).toMatchObject({ ok: true, redirect: "/app/x" });
  });
  it("hata sonucunda hata metnini taşır", () => {
    expect(resolveSubmitOutcome<R>({ error: "Yetkiniz yok" }, options)).toEqual({ ok: false, error: "Yetkiniz yok" });
  });
  it("ok olmayan ve hata içermeyen sonuç (çakışma uyarısı) başarı sayılmaz", () => {
    expect(resolveSubmitOutcome<R>({}, options)).toEqual({ ok: false, error: null });
  });
  it("successMessage fonksiyonu sonuçtan üretilebilir", () => {
    const out = resolveSubmitOutcome<R>(
      { ok: true, id: "1" },
      { ...options, successMessage: (r) => `Kayıt ${r.id}` },
    );
    expect(out).toMatchObject({ message: "Kayıt 1" });
  });
  it("özel isSuccess kararı kullanılır", () => {
    const out = resolveSubmitOutcome<R>({ id: "9" }, { ...options, isSuccess: (r) => Boolean(r.id) });
    expect(out).toMatchObject({ ok: true, redirect: "/app/x/9" });
  });
});
