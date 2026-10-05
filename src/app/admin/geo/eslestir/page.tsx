import Link from "next/link";
import { Link2 } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { listTenantGeoCandidates } from "@/lib/geo/backfill";
import { ApplyMatchButton } from "./apply-button";

const VIA: Record<string, string> = { exact: "tam eşleşme", alias: "takma ad", fuzzy: "yazım toleransı" };

export default async function AdminGeoMatchPage() {
  const staff = await requirePlatformModule("geo");
  const canWrite = staff.role === "super_admin";
  const { rows, total } = await listTenantGeoCandidates();
  const sure = rows.filter((r) => r.resolution.status === "ok" && r.resolution.via !== "fuzzy");
  const fuzzy = rows.filter((r) => r.resolution.status === "ok" && r.resolution.via === "fuzzy");
  const rest = rows.filter((r) => r.resolution.status !== "ok");

  return (
    <div className="space-y-6">
      <header>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-600"><Link2 className="h-3.5 w-3.5" /> Serbest metin → kimlik</p>
        <h1 className="mt-1 font-display text-2xl font-extrabold">Eşleştirme raporu</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Ofislerin serbest metin yazdığı şehir alanları (kimliksiz kayıtlar) coğrafya servisiyle çözülür. Tahmin yoktur: kesin eşleşmeler toplu uygulanır,
          yazım toleransıyla bulunanlar tek tek onay ister, belirsiz/bulunamayanlar elle düzeltilir. {total.toLocaleString("tr-TR")} kimliksiz ofis.
        </p>
      </header>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-lg font-bold">Kesin eşleşmeler ({sure.length})</h2>
          {canWrite ? <ApplyMatchButton ids={sure.slice(0, 200).map((r) => r.tenantId)} label={`Tümünü uygula (${Math.min(sure.length, 200)})`} /> : null}
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface text-sm">
          {sure.map((r) => (
            <li key={r.tenantId} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
              <Link href={`/admin/tenants/${r.tenantId}`} className="font-semibold hover:text-brand-600 hover:underline">{r.name}</Link>
              <span className="text-text-muted">“{r.city}” →</span>
              <b>{r.resolution.status === "ok" ? r.resolution.geo.provinceName : ""}</b>
              <span className="text-xs text-text-muted">{r.resolution.status === "ok" ? VIA[r.resolution.via] : ""}</span>
            </li>
          ))}
          {sure.length === 0 ? <li className="px-5 py-6 text-center text-xs text-text-muted">Kesin eşleşme yok.</li> : null}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-bold">Yazım toleransıyla bulunanlar ({fuzzy.length})</h2>
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface text-sm">
          {fuzzy.map((r) => (
            <li key={r.tenantId} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
              <Link href={`/admin/tenants/${r.tenantId}`} className="font-semibold hover:text-brand-600 hover:underline">{r.name}</Link>
              <span className="text-text-muted">“{r.city}” → önerilen:</span>
              <b>{r.resolution.status === "ok" ? r.resolution.geo.provinceName : ""}</b>
              {canWrite ? <ApplyMatchButton ids={[r.tenantId]} label="Bu öneriyi onayla" allowFuzzy /> : null}
            </li>
          ))}
          {fuzzy.length === 0 ? <li className="px-5 py-6 text-center text-xs text-text-muted">Kayıt yok.</li> : null}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-bold">Eşleşmeyen / belirsiz ({rest.length})</h2>
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface text-sm">
          {rest.map((r) => (
            <li key={r.tenantId} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
              <Link href={`/admin/tenants/${r.tenantId}`} className="font-semibold hover:text-brand-600 hover:underline">{r.name}</Link>
              <span className="text-text-muted">“{r.city}”</span>
              <span className="text-xs text-danger-500">
                {r.resolution.status === "ambiguous" ? `Belirsiz: ${r.resolution.candidates.map((c) => c.provinceName).join(" / ")}` : r.resolution.status === "unmatched" ? r.resolution.reason : ""}
              </span>
              <Link href={`/admin/tenants/${r.tenantId}`} className="ml-auto text-xs font-semibold text-brand-600 hover:underline">Ofiste il seç</Link>
            </li>
          ))}
          {rest.length === 0 ? <li className="px-5 py-6 text-center text-xs text-text-muted">Eşleşmeyen kayıt yok.</li> : null}
        </ul>
      </section>
    </div>
  );
}
