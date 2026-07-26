"use client";

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

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const strength = STRENGTH[passwordScore(password)];
  return (
    <div className="mt-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full transition-all ${strength.cls} ${strength.w}`} />
      </div>
      <p className="mt-1 text-[11px] font-semibold text-text-muted">Şifre gücü: {strength.label}</p>
    </div>
  );
}
