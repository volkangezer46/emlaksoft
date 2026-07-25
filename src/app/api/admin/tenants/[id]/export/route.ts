import { NextRequest, NextResponse } from "next/server";
import { requirePlatformModule } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * D4 — Offboarding vault: tenant'ın tüm verisini tek JSON dosyası olarak indir.
 * Sözleşme sonu / iptal durumunda müşteriye teslim edilecek veri paketi.
 * Sadece platform staff erişebilir.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePlatformModule("tenants");
  // Tam veri paketi hassas → yalnızca ops/super_admin (destek/muhasebe indiremez)
  if (staff.role !== "ops" && staff.role !== "super_admin") {
    return NextResponse.json({ error: "Bu işlem için yetkiniz yok." }, { status: 403 });
  }
  const { id: tenantId } = await params;
  const admin = createAdminClient();

  const { data: tenant } = await admin.from("tenants").select("*").eq("id", tenantId).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Tenant bulunamadı" }, { status: 404 });

  const tables = [
    "profiles",
    "branches",
    "customers",
    "customer_demands",
    "customer_files",
    "properties",
    "portal_listings",
    "listing_closures",
    "deals",
    "commissions",
    "calls",
    "appointments",
    "audit_logs",
    "notifications",
    "valuations",
    "payment_links",
  ];

  const exportData: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    tenant,
  };

  for (const table of tables) {
    const { data, error } = await admin.from(table).select("*").eq("tenant_id", tenantId).limit(20000);
    exportData[table] = error ? { error: error.message } : data ?? [];
  }

  const body = JSON.stringify(exportData, null, 2);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${tenant.name.replace(/[^a-z0-9]+/gi, "-")}-offboarding-${Date.now()}.json"`,
    },
  });
}
