import { isDemoLoginEnabled } from "@/lib/demo-environment";
import { googleErrorMessage, isGoogleAuthEnabled } from "@/lib/auth/google-auth";

import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";
import { LoginForm } from "./login-form";

// Giriş sayfası HER ZAMAN noindex'tir (registry canIndex=false kilidi; admin indekslenebilir yapamaz).
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/giris");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; hata?: string }>;
}) {
  const params = await searchParams;
  return (
    <LoginForm
      next={params.next ?? "/app"}
      demoEnabled={isDemoLoginEnabled()}
      googleEnabled={isGoogleAuthEnabled()}
      // Google dönüşünde callback'in verdiği bilinen kod → Türkçe mesaj (bilinmeyen kod gösterilmez).
      googleError={googleErrorMessage(params.hata)}
    />
  );
}
