/**
 * Form mantığı — saf fonksiyonlar (React/DOM yok; vitest node ortamında test edilir).
 *
 * `FormField`, `FormError` ve `useCreateForm` bu modülü kullanır: erişilebilirlik
 * öznitelikleri, hata sonrası adım bağlantısı ve "gönderim başarılı mı / nereye
 * gidilecek" kararı tek yerde durur.
 */

export type FormResultLike = { ok?: boolean; error?: string };

/** Hata/ipucu paragrafının id'si — aria-describedby bunu işaret eder. */
export function fieldDescribedBy(id: string | undefined, hasError: boolean, hasHint = true): string | undefined {
  if (!id) return undefined;
  if (hasError) return `${id}-error`;
  return hasHint ? `${id}-hint` : undefined;
}

export type FieldAriaInput = {
  id?: string;
  required?: boolean;
  error?: string | null;
  hint?: boolean;
};

export type FieldAria = {
  id?: string;
  "aria-required"?: true;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
};

/** Alana basılacak erişilebilirlik öznitelikleri; tanımsız olanlar hiç eklenmez. */
export function fieldAriaProps({ id, required, error, hint }: FieldAriaInput): FieldAria {
  const out: FieldAria = {};
  if (id) out.id = id;
  if (required) out["aria-required"] = true;
  const hasError = Boolean(error);
  if (hasError) out["aria-invalid"] = true;
  const describedBy = fieldDescribedBy(id, hasError, Boolean(hint));
  if (describedBy) out["aria-describedby"] = describedBy;
  return out;
}

export type NextStep = { href: string; label: string };

/** Hata metnine göre kullanıcıyı sonraki adıma götüren bağlantı (yoksa null). */
export function errorNextStep(error?: string | null): NextStep | null {
  if (!error) return null;
  const text = error.toLocaleLowerCase("tr-TR");
  if (/limit|kota|paket|aboneli/.test(text)) {
    return { href: "/app/abonelik", label: "Abonelik ve paketi görüntüle" };
  }
  return null;
}

export type SubmitOptions<R extends FormResultLike> = {
  /** Başarı toast'ı; fonksiyon verilirse sonuçtan üretilir. */
  successMessage: string | ((result: R) => string);
  /** Başarıda gidilecek adres (sonuçtaki id'den). */
  redirectTo: (result: R) => string;
  /** Varsayılan: `result.ok === true`. */
  isSuccess?: (result: R) => boolean;
};

export type SubmitOutcome =
  | { ok: true; message: string; redirect: string }
  | { ok: false; error: string | null };

/** Eylem sonucunu "toast + yönlendirme" ya da "hata" kararına çevirir. */
export function resolveSubmitOutcome<R extends FormResultLike>(result: R, options: SubmitOptions<R>): SubmitOutcome {
  const success = options.isSuccess ? options.isSuccess(result) : result.ok === true;
  if (!success) return { ok: false, error: result.error ?? null };
  const message = typeof options.successMessage === "function" ? options.successMessage(result) : options.successMessage;
  return { ok: true, message, redirect: options.redirectTo(result) };
}

/** Başarıda `/koleksiyon/<id>`, id yoksa liste adresi. */
export function detailOrList(listHref: string, id?: string | null): string {
  return id ? `${listHref}/${id}` : listHref;
}
