import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileSignature } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { EditContractForm } from "./edit-contract-form";

/**
 * Sözleşme düzenleme sayfası — detay sayfasındaki "Düzenle" linkinin hedefi.
 * Yalnızca taslak durumundaki sözleşmeler düzenlenebilir; kaydetmede önceki
 * içerik sürüm geçmişine yazılır (updateContract).
 */
export default async function ContractEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("contracts");
  const canEdit = perms.contracts?.includes("edit") ?? false;
  const { id } = await params;

  if (!canEdit) redirect(`/app/sozlesmeler/${id}`);

  const supabase = await createClient();
  const { data } = await supabase
    .from("contracts")
    .select("id, title, body, status")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  if (data.status !== "draft") redirect(`/app/sozlesmeler/${id}`); // Sadece taslak düzenlenir

  return (
    <div className="space-y-6">
      <Link
        href={`/app/sozlesmeler/${id}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Sözleşme detayı
      </Link>

      <section className="rounded-[20px] border border-line bg-surface p-6 shadow-[var(--shadow-xs)]">
        <h1 className="flex items-center gap-2 font-display text-xl font-extrabold text-ink-950">
          <FileSignature className="h-5 w-5 text-brand-600" /> Sözleşmeyi düzenle
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Kaydettiğinizde mevcut içerik sürüm geçmişine eklenir; gerekirse geri dönebilirsiniz.
        </p>

        <div className="mt-5">
          <EditContractForm id={id} title={data.title ?? ""} body={data.body ?? ""} />
        </div>
      </section>
    </div>
  );
}
