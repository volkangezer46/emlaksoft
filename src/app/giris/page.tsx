import { getDemoPolicyNow } from "@/lib/platform-security/demo-policy";
import { googleErrorMessage, isGoogleAuthEnabled } from "@/lib/auth/google-auth";
import { officeSecurityLoginNotice } from "@/lib/office-security/policy";

import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";
import { LoginForm } from "./login-form";
import { safeNextPath } from "@/lib/auth/safe-next";

// Giriş sayfası HER ZAMAN noindex'tir (registry canIndex=false kilidi; admin indekslenebilir yapamaz).
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/giris");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; hata?: string; reason?: string }>;
}) {
  // Demo kartları: env tavanı + yönetim anahtarı (Personel > Güvenlik politikası); eylem kararı sunucuda yineler.
  const [params, demo] = await Promise.all([searchParams, getDemoPolicyNow()]);
  return (
    <LoginForm
      next={safeNextPath(params.next)}
      demoEnabled={demo.tenant}
      platformDemoEnabled={demo.platform}
      googleEnabled={isGoogleAuthEnabled()}
      // Google dönüşünde callback'in verdiği bilinen kod → Türkçe mesaj (bilinmeyen kod gösterilmez).
      // DG7: ofis güvenlik politikasının kapattığı oturum (?reason=office_ip|office_idle|office_session) aynı uyarı alanında.
      googleError={googleErrorMessage(params.hata) ?? officeSecurityLoginNotice(params.reason)}
    />
  );
}
