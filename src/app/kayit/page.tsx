import { RegisterForm } from "./register-form";
import { isRegistrationOpen } from "@/lib/platform-flags";
import { isGoogleAuthEnabled } from "@/lib/auth/google-auth";
import { loadRegisterFormProps, RegistrationClosed, type RegisterSearchParams } from "./_lib/register-page-data";

import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/kayit");
}

export default async function RegisterPage({
  searchParams,
}: {
  // plan/cycle/seats (fiyat sayfası), ref + utm_source/utm_medium/utm_campaign (büyüme atfı).
  searchParams: Promise<RegisterSearchParams>;
}) {
  const params = await searchParams;
  if (!(await isRegistrationOpen())) return <RegistrationClosed />;
  const props = await loadRegisterFormProps(params);
  return <RegisterForm {...props} googleEnabled={isGoogleAuthEnabled()} />;
}
