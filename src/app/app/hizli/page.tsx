import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now, toTrLocalInput } from "@/lib/clock";
import { getDefinitions } from "@/lib/definitions";
import { DEFAULT_DEFINITIONS } from "@/lib/definition-defaults";
import { PageHeader } from "@/components/ui/page-header";
import { ICONS } from "@/lib/icons";
import { sanitizeWatermarkSettings } from "@/lib/watermark";
import { QuickCapture, type QuickTabId } from "./quick-capture";

export const metadata = { title: "Hızlı kayıt" };

const HOUR_MS = 3_600_000;

export default async function QuickCapturePage({
  searchParams,
}: {
  searchParams?: Promise<{ sekme?: string }>;
}) {
  // Ana ekran kapısı; sekmeler ilgili modülün "create" iznine göre belirlenir, hiçbiri yoksa erişim yok.
  const { perms, tenantId } = await requireModulePage("dashboard");
  const can = (mod: "customers" | "calls" | "appointments" | "properties") => (perms[mod] ?? []).includes("create");
  const tabs: QuickTabId[] = [];
  if (can("customers")) tabs.push("musteri");
  if (can("calls")) tabs.push("gorusme");
  if (can("appointments")) tabs.push("randevu");
  // Sahadan portföy: oluşturma + fotoğraf için düzenleme izni (medya yükleme `properties:edit`).
  if (can("properties") && (perms.properties ?? []).includes("edit")) tabs.push("portfoy");
  if (tabs.length === 0) redirect("/app?yetki=yok");

  const sp = (await searchParams) ?? {};
  const wanted = ({ musteri: "musteri", gorusme: "gorusme", randevu: "randevu", portfoy: "portfoy" } as Record<string, QuickTabId>)[sp.sekme ?? ""];
  const initial = wanted && tabs.includes(wanted) ? wanted : tabs[0];

  const supabase = await createClient();
  const wantsCustomers = tabs.includes("gorusme") || tabs.includes("randevu");
  const wantsProperty = tabs.includes("portfoy");
  const [{ data: customers }, { data: properties }, typeDefs, propTypeDefs, txDefs, { data: brandRow }] = await Promise.all([
    wantsCustomers
      ? supabase.from("customers").select("id, full_name, phone").is("deleted_at", null).order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] }),
    tabs.includes("randevu")
      ? supabase.from("properties").select("id, title, property_code").is("deleted_at", null).order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] }),
    tabs.includes("randevu") ? getDefinitions("appointment_type") : Promise.resolve([]),
    wantsProperty ? getDefinitions("property_type") : Promise.resolve([]),
    wantsProperty ? getDefinitions("transaction_type") : Promise.resolve([]),
    // Fotoğraf filigranı istemcide basılır (portföy detayıyla aynı ayar + logo + ofis adı).
    wantsProperty && tenantId
      ? supabase.from("tenants").select("name, logo_url, watermark_settings").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const defs = (rows: { value: string; label: string }[], fallback: readonly { value: string; label: string }[]) =>
    rows.length > 0 ? rows.map((t) => ({ value: t.value, label: t.label })) : [...fallback];
  const brand = brandRow as { name: string | null; logo_url: string | null; watermark_settings: unknown } | null;

  const typeOptions =
    typeDefs.length > 0
      ? typeDefs.map((t) => ({ value: t.value, label: t.label }))
      : [...DEFAULT_DEFINITIONS.appointment_type];
  // Ön dolgu: bir sonraki tam saat (Türkiye saati).
  const defaultWhen = toTrLocalInput(Math.ceil(now() / HOUR_MS) * HOUR_MS + HOUR_MS);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader
        title="Hızlı kayıt"
        icon={<ICONS.hizli className="h-6 w-6 text-accent" aria-hidden />}
        description="Sahadayken birkaç alanla kaydedin; ayrıntıyı sonra tamamlarsınız."
      />
      <QuickCapture
        tabs={tabs}
        initial={initial}
        customers={(customers ?? []).map((c) => ({ value: c.id, label: c.full_name ?? "İsimsiz", hint: c.phone ?? undefined }))}
        properties={(properties ?? []).map((p) => ({ value: p.id, label: p.title || p.property_code, hint: p.property_code }))}
        typeOptions={typeOptions}
        defaultWhen={defaultWhen}
        propertyTypeOptions={defs(propTypeDefs, DEFAULT_DEFINITIONS.property_type)}
        transactionOptions={defs(txDefs, DEFAULT_DEFINITIONS.transaction_type)}
        brand={
          wantsProperty
            ? { watermark: sanitizeWatermarkSettings(brand?.watermark_settings ?? null), officeName: brand?.name ?? "", logoUrl: brand?.logo_url ?? null }
            : undefined
        }
      />
    </div>
  );
}
