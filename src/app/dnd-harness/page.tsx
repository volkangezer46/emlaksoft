// GEÇİCİ doğrulama düzeneği (commit EDİLMEZ).
import "../theme-dark.css";
import { Harness } from "./harness";

export default async function Page({ searchParams }: { searchParams: Promise<{ yetki?: string }> }) {
  const sp = await searchParams;
  return <Harness canEdit={sp.yetki !== "0"} />;
}
