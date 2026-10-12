import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { isSameOriginBridgeRequest } from "@/lib/listing-control/worker/bridge-request";
import { fsboSaveSchema } from "@/lib/prospecting/schema";
import { saveFsboLead, type Db } from "@/lib/prospecting/store";
import { resolveDistrict } from "@/lib/prospecting/district";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;
const MAX_BODY = 8_000;

/**
 * POST /api/app/portfoy-avi/kaydet — eklentideki "EmlakSoft'a sahibinden ilan olarak kaydet" yükleme ucu.
 * Eklentinin içerik betiği (yalnız EmlakSoft sayfasında) kullanıcının AÇIK OTURUMUYLA aynı kökenden çağırır; tek ilan,
 * kullanıcının tıklamasıyla okunmuş ve onaylanmıştır. Sunucu portala istek ATMAZ (kazıma yok). Telefon `parsePhoneStrict`
 * ile doğrulanır; kayıt idempotenttir (portal + ilan no: tekrar kayıt = yeni fiyat gözlemi). CSRF: aynı köken + özel başlık.
 */
const bodySchema = z.object({
  url: z.string().max(600),
  title: z.string().max(200).nullish(),
  price: z.union([z.number(), z.string()]).nullish(),
  rooms: z.string().max(20).nullish(),
  grossM2: z.union([z.number(), z.string()]).nullish(),
  locationText: z.string().max(200).nullish(),
  listedAt: z.string().max(10).nullish(),
  ownerName: z.string().max(120).nullish(),
  transactionType: z.enum(["sale", "rent"]).nullish(),
  phone: z.string().max(40).nullish(),
});

export async function POST(request: Request) {
  if (!isSameOriginBridgeRequest(request)) return NextResponse.json({ ok: false, error: "origin" }, { status: 403, headers: NO_STORE });
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ ok: false, error: "session" }, { status: 401, headers: NO_STORE });
  const limit = await checkRateLimit(`fsbo-save:${user.id}`, { limit: 30, windowSec: 60, failurePolicy: "deny" });
  if (!limit.allowed) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });

  const gate = await requirePermission("prospecting", "create");
  if (!gate.ok) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: NO_STORE });

  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
    body = bodySchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  }

  const db = (await createClient()) as Db;
  const place = await resolveDistrict(body.locationText ?? null);
  const parsed = fsboSaveSchema.safeParse({
    source: "extension",
    url: body.url,
    title: body.title,
    price: body.price,
    rooms: body.rooms,
    grossM2: body.grossM2,
    locationText: body.locationText,
    listedAt: /^\d{4}-\d{2}-\d{2}$/.test(body.listedAt ?? "") ? body.listedAt : null,
    ownerName: body.ownerName,
    transactionType: body.transactionType ?? "sale",
    phone: body.phone,
    districtId: place?.districtId ?? null,
    provinceId: place?.provinceId ?? null,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_input", message: parsed.error.issues[0]?.message ?? "Girdi geçersiz." }, { status: 400, headers: NO_STORE });
  }

  const res = await saveFsboLead({ db, tenantId: gate.tenantId, userId: gate.userId, role: gate.role }, parsed.data);
  if (!res.ok) return NextResponse.json({ ok: false, error: "save_failed", message: res.error }, { status: 502, headers: NO_STORE });
  revalidatePath("/app/portfoy-avi");
  return NextResponse.json(
    {
      ok: true,
      id: res.id,
      created: res.created,
      /** İlan zaten kayıtlıydı ve sizindi: yeni fiyat gözlemi eklendi. */
      updated: res.ownership.kind !== "other" && !res.created,
      ownedByOther: res.ownership.kind === "other" ? res.ownership.message : null,
      notices: res.notices.map((n) => n.message),
      priceDropPct: res.priceDropPct,
    },
    { headers: NO_STORE },
  );
}
