import Link from "next/link";
import { ArrowUpRight, Settings } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { requirePlatformModule } from "@/lib/platform";
import { getGeneralSettings } from "@/lib/platform-flags";
import { createAdminClient } from "@/lib/supabase/admin";
import { GeneralSettingsForm } from "./general-settings-form";

export const metadata = { title: "Platform ayarları" };

/** Deneme süresi SQL fonksiyonu (migration 20260816010100) uygulanmış mı? Salt-okunur yoklama. */
async function trialFunctionApplied(): Promise<boolean> {
  try {
    const { error } = await createAdminClient().rpc("platform_default_trial_days");
    return !error;
  } catch {
    return false;
  }
}

export default async function AdminSettingsPage() {
  const staff = await requirePlatformModule("sistem");
  const [settings, trialApplied] = await Promise.all([getGeneralSettings(), trialFunctionApplied()]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Platform"
        icon={Settings}
        title="Genel ayarlar"
        description="Bakım modu, yeni kayıt ve varsayılan deneme süresi. Entegrasyon anahtarları Sistem sayfasındadır."
      />
      {!trialApplied ? (
        <p role="status" className="rounded-[var(--radius-card)] border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Deneme süresi veritabanı fonksiyonu henüz uygulanmamış: değer kaydedilir ama yeni kayıtlar 14 gün olarak devam eder.
        </p>
      ) : null}
      <GeneralSettingsForm initial={settings} canEdit={staff.role === "super_admin"} />
      <Link href="/admin/ayarlar/tufe" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
        TÜFE tablosu (kira artışı oranları) <ArrowUpRight className="h-3 w-3" />
      </Link>
      <Link href="/admin/sistem" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
        Entegrasyon anahtarları ve sistem sağlığı <ArrowUpRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
