/**
 * Destek e-postası TEK KAYNAK. Yasal sayfalar, SSS, menü, push ve bildirimler buradan okur;
 * kaynakta başka yerde sabit adres yazılmaz (contact-info-contract.test.ts).
 * Üretimde NEXT_PUBLIC_SUPPORT_EMAIL ile değiştirilir (docs/DEPLOY.md).
 */
export const SUPPORT_EMAIL: string = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "destek@emlaksoft.app";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
