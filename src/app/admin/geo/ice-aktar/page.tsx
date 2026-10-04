import { FileUp } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { ImportPanel } from "./import-panel";

export default async function AdminGeoImportPage() {
  const staff = await requirePlatformModule("geo");
  const canWrite = staff.role === "super_admin";
  return (
    <div className="space-y-5">
      <header>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-600">
          <FileUp className="h-3.5 w-3.5" /> Toplu içe aktarma
        </p>
        <h1 className="mt-1 font-display text-2xl font-extrabold">Coğrafya içe aktarma</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          CSV veya JSON yükleyin. Önce KURU ÇALIŞTIRMA: eklenecek / değişecek / pasife alınacak sayıları ve tıklanabilir liste.
          Onaydan sonra partilerle uygulanır; hata yarım bırakmaz (yapılanlar sürüm kaydında durur ve geri alınır).
          Aynı mantık komut satırında: <code>npm run geo:import -- --file X --dry-run</code>.
        </p>
      </header>
      <ImportPanel canWrite={canWrite} />
    </div>
  );
}
