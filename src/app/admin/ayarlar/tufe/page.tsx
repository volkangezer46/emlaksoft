import Link from "next/link";
import { ArrowLeft, Percent } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { requirePlatformModule } from "@/lib/platform";
import { loadTufeTable } from "@/lib/tufe-server";
import { TUFE_UNVERIFIED_NOTICE } from "@/lib/tufe";
import { TufeForm } from "./tufe-form";

export const metadata = { title: "TÜFE tablosu" };

export default async function AdminTufePage() {
  const staff = await requirePlatformModule("sistem");
  const table = await loadTufeTable();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Platform"
        icon={Percent}
        title="TÜFE tablosu"
        description="Kira artışı hesabında kullanılan 12 aylık ortalama TÜFE oranları. Yalnız süper admin düzenler."
      />
      {!table.fromSettings ? (
        <p role="status" className="rounded-[var(--radius-card)] border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Kayıtlı tablo yok: gömülü tablo gösteriliyor ve hiçbir satırı resmi değil. {TUFE_UNVERIFIED_NOTICE} Resmi TÜİK bülteninden
          doğruladığınız satırları işaretleyip doğrulama tarihi ve kaynağı girin.
        </p>
      ) : null}
      <TufeForm initial={table} canEdit={staff.role === "super_admin"} />
      <Link href="/admin/ayarlar/merkez" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
        <ArrowLeft className="h-3 w-3" /> Ayar merkezine dön
      </Link>
    </div>
  );
}
