import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Müşteri belgesi görüntüleme yetkisi gerektirir (tenant-içi gizlilik)
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403 });

  const { id } = await params;
  const supabase = await createClient();

  const { data: file } = await supabase
    .from("customer_files")
    .select("file_name, file_type, storage_path")
    .eq("id", id)
    .maybeSingle();

  if (!file) {
    return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 404 });
  }

  const { data: blob, error } = await supabase.storage
    .from("customer-files")
    .download(file.storage_path);

  if (error || !blob) {
    console.error("download error", error);
    return NextResponse.json({ error: "İndirme başarısız" }, { status: 500 });
  }

  // Belge Merkezi (/app/belgeler) önizlemesi için inline mod: ?onizle=1
  // Varsayılan davranış (attachment) bilinçli olarak değiştirilmedi —
  // müşteri detayındaki mevcut "indir" bağlantıları aynı kalsın.
  const inline = new URL(req.url).searchParams.get("onizle") === "1";

  return new NextResponse(blob, {
    headers: {
      "Content-Type": file.file_type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
