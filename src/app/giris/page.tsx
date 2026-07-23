import { isDemoLoginEnabled } from "@/lib/demo-personas";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm next={params.next ?? "/app"} demoEnabled={isDemoLoginEnabled()} />;
}
