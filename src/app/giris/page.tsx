import { isDemoLoginEnabled } from "@/lib/demo-personas";

export const metadata = {
  title: "Giriş Yap",
  description: "EmlakSoft ofis ve personel paneline güvenli giriş.",
  alternates: { canonical: "/giris" },
  robots: { index: false, follow: true },
};
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm next={params.next ?? "/app"} demoEnabled={isDemoLoginEnabled()} />;
}
