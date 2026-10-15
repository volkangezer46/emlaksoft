"use client";

import { checkPasswordPolicy, type PasswordContext } from "@/lib/password-policy";

/**
 * Şifre gücü ölçeri — kayıt ve şifre yenileme aynı ölçeri paylaşır.
 * Skor 0-4: uzunluk, büyük/küçük harf, rakam ve özel karakter puanlanır.
 */
export function passwordScore(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-ZĞÜŞİÖÇ]/.test(pw) && /[a-zğüşıöç]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9ĞÜŞİÖÇğüşıöç]/.test(pw)) s++;
  return Math.min(s, 4); // 0-4
}

const STRENGTH = [
  { label: "Çok zayıf", cls: "bg-danger-500", w: "w-1/4" },
  { label: "Zayıf", cls: "bg-danger-500", w: "w-1/4" },
  { label: "Orta", cls: "bg-amber-400", w: "w-2/4" },
  { label: "İyi", cls: "bg-mint-500", w: "w-3/4" },
  { label: "Güçlü", cls: "bg-mint-600", w: "w-full" },
];

/**
 * `context` verilirse ortak parola politikası (`@/lib/password-policy`: yaygın/Türkçe zayıf liste, dizi, e-posta/ad/ofis
 * adı) canlı uygulanır: ihlalde gösterge "Zayıf"ta kalır ve nedeni tek cümleyle yazılır. Sunucu aynı kuralı yeniden uygular.
 */
export function PasswordStrengthMeter({ password, context }: { password: string; context?: PasswordContext }) {
  if (!password) return null;
  const policy = context ? checkPasswordPolicy(password, context) : null;
  const violation = policy && !policy.ok && policy.issue !== "too_short" ? policy.message : null;
  const strength = STRENGTH[violation ? Math.min(passwordScore(password), 1) : passwordScore(password)];
  return (
    <div className="mt-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full transition-all ${strength.cls} ${strength.w}`} />
      </div>
      <p className="mt-1 text-xs font-semibold text-text-muted" aria-live="polite">
        Şifre gücü: {strength.label}
        {violation ? <span className="mt-0.5 block font-medium text-danger-600">{violation}</span> : null}
      </p>
    </div>
  );
}
