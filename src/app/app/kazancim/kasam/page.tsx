import { now, trDayKey } from "@/lib/clock";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { KasamTab } from "./kasam-tab";

export const metadata = { title: "Kasam · Kazancım" };

/**
 * Kazancım > Kasam (`/app/kazancim/kasam`): kullanıcının KENDİ kişisel kasa/banka hesapları, hareketleri ve düzenli
 * ödemeleri. Kapı `dashboard:view` (her rol); ofis verisi bu görünümde asla sorgulanmaz (asıl kural RPC + RLS).
 */
export default async function KasamPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ userId }, params, supabase] = await Promise.all([requireModulePage("dashboard"), searchParams ?? Promise.resolve({}), createClient()]);
  return <KasamTab supabase={supabase} userId={userId} params={params} today={trDayKey(now())} />;
}
