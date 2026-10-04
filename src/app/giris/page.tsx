import { isDemoLoginEnabled } from "@/lib/demo-environment";

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
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm next={params.next ?? "/app"} demoEnabled={isDemoLoginEnabled()} />;
}
