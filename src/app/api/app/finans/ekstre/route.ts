import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSameOriginBridgeRequest } from "@/lib/listing-control/worker/bridge-request";
import { previewStatement, stageStatement } from "@/lib/finance/statement/service";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

/**
 * BANKA EKSTRESİ YÜKLEME UCU (Finans > Kasa ve banka > "Ekstre yükle"). İkili dosya gövdesi server action yerine burada alınır
 * (action gövde sınırı yalnız logo/foto eylemlerine ayrılmıştır). `op=preview` dosyayı okur (hiçbir şey kaydetmez), `op=stage` satırları
 * TASLAK olarak yazar. Yetki ve tüm kurallar `service.ts` + finance_statement_* RPC'sindedir (JWT kimlikli, service_role YOK).
 * CSRF: aynı köken + özel başlık (`x-emlaksoft-bridge: 1`). Hız sınırı kullanıcı başına dakikada 20, sayaç arızasında reddeder.
 * Dosya adı ve içeriği loglanmaz.
 */
export async function POST(request: Request) {
  if (!isSameOriginBridgeRequest(request)) return NextResponse.json({ error: "İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin." }, { status: 403, headers: NO_STORE });
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Oturum bulunamadı. Yeniden giriş yapın." }, { status: 401, headers: NO_STORE });
  const limit = await checkRateLimit(`fin-stmt:${user.id}`, { limit: 20, windowSec: 60, failurePolicy: "deny" });
  if (!limit.allowed) return NextResponse.json({ error: "Çok sık deneme yapıldı. Bir dakika sonra tekrar deneyin." }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });

  // Gövde sınırı: dosya 2 MB + alanlar için pay; büyük gövde okunmadan reddedilir.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 2 * 1024 * 1024 + 64 * 1024) return NextResponse.json({ error: "Dosya en çok 2 MB olabilir." }, { status: 413, headers: NO_STORE });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Dosya okunamadı. Tekrar deneyin." }, { status: 400, headers: NO_STORE });
  }
  const op = form.get("op");
  const accountId = String(form.get("accountId") ?? "");
  if (op === "preview") return NextResponse.json(await previewStatement(accountId, form), { headers: NO_STORE });
  if (op === "stage") return NextResponse.json(await stageStatement(accountId, form), { headers: NO_STORE });
  return NextResponse.json({ error: "Geçersiz istek." }, { status: 400, headers: NO_STORE });
}
