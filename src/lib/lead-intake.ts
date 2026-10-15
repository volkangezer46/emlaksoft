import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { EMAIL_ERROR_MESSAGE, isValidOptionalEmail, normalizeEmail } from "@/lib/email";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { notifyTenant } from "@/lib/notify";
import { buildLeadCommunication } from "@/lib/lead-message";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { routeNewLead } from "@/lib/lead-routing/server";
import { now } from "@/lib/clock";
import { dispatchAutomationEvent } from "@/lib/automation-engine";
import { SALES_ASSIGNEE_ROLES } from "@/lib/team/assignable-roles";
import { withinBusinessHours } from "@/lib/lead-routing/logic";
import { loadLeadListing, listingContextLine } from "@/lib/lead-listing";
import { resolveAddressText } from "@/lib/geo/address-resolve-server";

export type LeadInput = {
  fullName: string;
  phone?: string;
  email?: string;
  message?: string;
  source?: string;
  channel?: string;
  transactionType?: string;
  propertyType?: string;
  provinceId?: string;
  /**
   * Serbest konum metni ("Kadıköy İstanbul", "Moda, Kadıköy"): il/ilçe/mahalleye çözülür (address-resolve). Formlar
   * il kimliği yerine il ADI ya da plaka da gönderebilir (`provinceId` alanında); o da aynı adımda çözülür.
   */
  locationText?: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  rooms?: string;
  /** Müşteri tipleri (definitions/customer_type). Verilmezse ['alici'] — geriye uyumlu. */
  customer_types?: string[];
  /**
   * İlan bağlamı (COM-13): formdaki `?ilan=` değeri (portföy kimliği ya da kodu). Sunucuda bu ofise ait YAYINDAKİ
   * portföye çözülür (IDOR yok); çözülemezse yok sayılır. Talep notuna ve iletişim kaydının portföy bağına yazılır.
   */
  listingRef?: string;
  consent?: {
    requestId: string;
    scope: "lead_intake" | "valuation_lead";
    version: string;
    acceptedAt: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
  };
};

export type LeadResult =
  | { ok: true; customerId: string; assignedTo: string | null; duplicate: boolean }
  | { ok: false; error: string; status: number };


/**
 * Aktif danışmanlar arasında en az yüklü olana atar (round-robin/least-loaded).
 * Böylece gelen her lead adil biçimde dağıtılır ve speed-to-lead sağlanır.
 */
async function pickAssignee(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<string | null> {
  const { data: members } = await admin
    .from("profiles")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("role", SALES_ASSIGNEE_ROLES);

  if (!members || members.length === 0) return null;

  // Danışman rolü öncelikli; yoksa yönetici rollerine düş.
  const advisors = members.filter((m) => m.role === "advisor" || m.role === "team_lead");
  const pool = advisors.length > 0 ? advisors : members;

  const { data: loads } = await admin
    .from("customers")
    .select("assigned_to")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .not("assigned_to", "is", null);

  const counts = new Map<string, number>();
  for (const m of pool) counts.set(m.id, 0);
  for (const row of loads ?? []) {
    const a = (row as { assigned_to: string | null }).assigned_to;
    if (a && counts.has(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const m of pool) {
    const c = counts.get(m.id) ?? 0;
    if (c < bestCount) {
      bestCount = c;
      best = m.id;
    }
  }
  return best;
}

export type RoutedLeadCustomerInput = {
  fullName: string;
  /** Doğrulanmış saklama biçimi (parsePhoneStrict().stored) ya da null. */
  phone: string | null;
  email?: string | null;
  source: string;
  channel: string;
  notes?: string | null;
  customerTypes?: string[];
  provinceId?: string | null;
  propertyType?: string | null;
  transactionType?: string | null;
  budgetMax?: number | null;
};

export type RoutedLeadCustomerResult =
  | { ok: true; customerId: string; assignedTo: string | null; routing: { strategy: string; reason: string; deferred: boolean } | null }
  | { ok: false; error: string };

/**
 * TEK yeni-aday oluşturucu: dağıtım motoruyla (yöntem/mesai ofis ayarından; motor hata verirse "en az yüklü") danışman
 * seçer ve müşteriyi yazar. Public form (intakeLead) ve bilinmeyen numaradan gelen mesaj (automation/inbound-intake)
 * aynı yolu kullanır. Telefon çağıranda `parsePhoneStrict` ile doğrulanmış olmalıdır.
 */
export async function createRoutedLeadCustomer(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  input: RoutedLeadCustomerInput,
): Promise<RoutedLeadCustomerResult> {
  let assignedTo: string | null = null;
  let routing: { strategy: string; reason: string; deferred: boolean } | null = null;
  const route = await routeNewLead(
    admin,
    tenantId,
    { provinceId: input.provinceId || null, propertyType: input.propertyType || null, transactionType: input.transactionType || null, budgetMax: input.budgetMax ?? null },
    now(),
  );
  if (route.ok) {
    assignedTo = route.assigneeId;
    routing = { strategy: route.strategy, reason: route.reason, deferred: route.deferred };
  } else {
    assignedTo = await pickAssignee(admin, tenantId);
  }
  const { data: created, error } = await admin
    .from("customers")
    .insert({
      tenant_id: tenantId,
      full_name: input.fullName,
      phone: input.phone || null,
      email: normalizeEmail(input.email ?? undefined) || null,
      customer_types: input.customerTypes?.length ? input.customerTypes : ["alici"],
      province_id: input.provinceId || null,
      source: input.source,
      lead_channel: input.channel,
      auto_assigned: !!assignedTo,
      assigned_to: assignedTo,
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("createRoutedLeadCustomer insert", error);
    return { ok: false, error: "Kayıt oluşturulamadı." };
  }
  return { ok: true, customerId: created.id as string, assignedTo, routing };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LeadLocation = { provinceId: string | null; districtId: string | null; neighborhoodId: string | null };

/**
 * Başvurunun konumu: il kimliği geldiyse aynen; il adı/plaka ya da serbest konum metni geldiyse coğrafya merkezinden
 * çözülür (belirsizse boş kalır — tahmin yok). Çözüm hatası başvuruyu ASLA düşürmez.
 */
export async function resolveLeadLocation(input: Pick<LeadInput, "provinceId" | "locationText">): Promise<LeadLocation> {
  const prov = (input.provinceId ?? "").trim();
  const text = (input.locationText ?? "").trim().slice(0, 200);
  const empty: LeadLocation = { provinceId: null, districtId: null, neighborhoodId: null };
  if (UUID_RE.test(prov) && !text) return { ...empty, provinceId: prov };
  if (!prov && !text) return empty;
  try {
    const r = await resolveAddressText({ province: UUID_RE.test(prov) ? null : prov || null, text });
    const g = r.geo;
    // İl kimliği verildiyse metinden çıkan ilçe yalnız o ile aitse kullanılır.
    if (UUID_RE.test(prov) && g.provinceId && g.provinceId !== prov) return { ...empty, provinceId: prov };
    return {
      provinceId: g.provinceId ?? (UUID_RE.test(prov) ? prov : null),
      districtId: g.districtId,
      neighborhoodId: g.neighborhoodId,
    };
  } catch (e) {
    console.error("intakeLead konum çözümü", e instanceof Error ? e.message : "unknown");
    return UUID_RE.test(prov) ? { ...empty, provinceId: prov } : empty;
  }
}

export async function intakeLead(token: string, input: LeadInput): Promise<LeadResult> {
  const fullName = input.fullName?.trim();
  if (!fullName) return { ok: false, error: "Ad soyad zorunlu.", status: 400 };
  // customers.phone DB'de yalnız TR cep (05XXXXXXXXX) kabul eder; yabancı numara için migration gerekir.
  const phoneParsed = input.phone?.trim() ? parsePhoneStrict(input.phone) : null;
  if (phoneParsed && (!phoneParsed.ok || phoneParsed.country !== "TR" || phoneParsed.kind !== "mobile")) {
    return { ok: false, error: "Geçerli bir Türk cep telefonu girin.", status: 400 };
  }
  if (!isValidOptionalEmail(input.email)) {
    return { ok: false, error: EMAIL_ERROR_MESSAGE, status: 400 };
  }

  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, status, lead_capture_enabled")
    .eq("lead_capture_token", token)
    .maybeSingle();

  if (!tenant || !isPublicTenantActive(tenant.status)) {
    return { ok: false, error: "Geçersiz bağlantı.", status: 404 };
  }
  if (tenant.lead_capture_enabled === false) {
    return { ok: false, error: "Bu form şu anda kapalı.", status: 403 };
  }

  const tenantId = tenant.id as string;
  const phone = phoneParsed?.stored ?? "";
  const location = await resolveLeadLocation(input);
  const channel = (input.channel || "web_form").slice(0, 40);
  const source = (input.source || channel).slice(0, 80);

  // Telefonla mükerrer kayıt kontrolü
  let customerId: string | null = null;
  let assignedTo: string | null = null;
  let duplicate = false;
  let routing: { strategy: string; reason: string; deferred: boolean } | null = null;

  if (phone) {
    const { data: existing } = await admin
      .from("customers")
      .select("id, assigned_to")
      .eq("tenant_id", tenantId)
      .eq("phone", phone)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (existing) {
      customerId = existing.id as string;
      assignedTo = (existing.assigned_to as string | null) ?? null;
      duplicate = true;
    }
  }

  // İlan bağlamı: yalnız bu ofise ait, yayındaki portföy (çözülemezse yok sayılır).
  const listing = input.listingRef ? await loadLeadListing(admin, tenantId, input.listingRef) : null;
  const listingLine = listing ? listingContextLine(listing) : null;
  const messageWithListing = [listingLine, input.message?.trim()].filter(Boolean).join("\n") || undefined;

  if (!customerId) {
    // TEK MOTOR (lead-routing): yöntem/mesai ofis ayarından; motor hata verirse eski "en az yüklü" yoluna düşer.
    const created = await createRoutedLeadCustomer(admin, tenantId, {
      fullName,
      phone: phone || null,
      email: input.email ?? null,
      source,
      channel,
      notes: messageWithListing ?? null,
      customerTypes: input.customer_types,
      provinceId: location.provinceId,
      propertyType: input.propertyType || null,
      transactionType: input.transactionType || null,
      budgetMax: input.budgetMax ?? null,
    });
    if (!created.ok) return { ok: false, error: created.error, status: 500 };
    customerId = created.customerId;
    assignedTo = created.assignedTo;
    routing = created.routing;
  }

  // Public forms must persist server-verified consent evidence before the lead
  // is treated as accepted. A retry is safe because request_id is unique.
  if (input.consent) {
    const { error: consentError } = await admin.from("public_lead_consent_events").insert({
      request_id: input.consent.requestId,
      tenant_id: tenantId,
      customer_id: customerId,
      consent_scope: input.consent.scope,
      consent_version: input.consent.version,
      source,
      ip_hash: input.consent.ipHash ?? null,
      user_agent_hash: input.consent.userAgentHash ?? null,
      accepted_at: input.consent.acceptedAt,
    });
    if (consentError) {
      if (consentError.code === "23505") {
        return { ok: true, customerId, assignedTo, duplicate: true };
      }
      console.error("intakeLead consent evidence", { code: consentError.code });
      return { ok: false, error: "Onay kaydı oluşturulamadı.", status: 500 };
    }
  }

  /*
   * TALEP MESAJINI ASLA KAYBETME (denetim P0).
   *
   * Eskiden `input.message` yalnızca YENİ müşteri insert'inde
   * `customers.notes` alanına yazılıyordu; telefonu eşleşen mevcut müşteride
   * mesaj hiçbir yere gitmiyordu. Artık her talep `communications` tablosuna
   * `inbound` satır olarak da düşüyor — müşteri detayındaki iletişim zaman
   * çizgisinde ve /app/gelen-kutusu'nda görünür. Gerekçe: lib/lead-message.ts.
   *
   * Mükerrer olmayan durumda da yazılıyor: notes "profil notu", communications
   * "zaman çizgisi" — ikisi farklı iş görüyor ve tek bir yol olması davranışı
   * öngörülebilir kılıyor.
   *
   * Best-effort: iletişim kaydı yazılamazsa lead yine de kaydedilmiş sayılır
   * (asıl kayıt customers satırı), ama sessiz kalmasın diye loglanır.
   */
  const commDraft = buildLeadCommunication({
    customerId,
    message: messageWithListing,
    channel,
    source,
    duplicate,
  });
  if (commDraft) {
    const { error: commErr } = await admin.from("communications").insert({
      tenant_id: tenantId,
      created_by: null, // public form — panel kullanıcısı yok
      ...commDraft,
      // Danışman hangi ilanı sorduğunu iletişim kaydından portföye tıklayarak görür (COM-13).
      ...(listing ? { property_id: listing.id } : {}),
    });
    if (commErr) console.error("intakeLead communication", commErr);
  }

  // Talep bilgisi verilmişse demand oluştur
  if (input.transactionType) {
    await admin.from("customer_demands").insert({
      tenant_id: tenantId,
      customer_id: customerId,
      transaction_type: input.transactionType,
      property_type: input.propertyType || null,
      province_id: location.provinceId,
      district_id: location.districtId,
      neighborhood_id: location.neighborhoodId,
      budget_min: input.budgetMin ?? null,
      budget_max: input.budgetMax ?? null,
      rooms: input.rooms || null,
      status: "new",
    });
  }

  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: null,
    action: duplicate ? "lead.intake.duplicate" : "lead.intake",
    entity_type: "customer",
    entity_id: customerId,
    new_value: { full_name: fullName, phone, channel, source, assigned_to: assignedTo, ...(routing ? { routing } : {}), ...(listing ? { property_id: listing.id } : {}) },
  });

  /*
   * Speed-to-lead: sorumlu danışmana anında bildirim (yoksa ofis geneli).
   * Mükerrer durumda mesajın ilk satırı gövdeye eklenir — danışman bildirimden
   * talebin İÇERİĞİNİ de görsün, yalnız "tekrar eden kayıt" demekle kalmasın
   * (değerleme hunisinde tüm detay mesajın içinde).
   */
  const mesajOzeti = (input.message ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  await notifyTenant({
    tenantId,
    userId: assignedTo,
    title: duplicate ? "Mevcut müşteriden yeni talep" : "Yeni talep geldi",
    body: `${fullName}${phone ? ` · ${phone}` : ""} · ${source}${listing ? ` · ${listing.code ?? "ilan"}` : ""}${mesajOzeti ? ` · ${mesajOzeti}` : ""}`,
    href: `/app/musteriler/${customerId}`,
    kind: "success",
  });

  // Yeni aday = yeni müşteri: ofisin "new_customer" otomasyonları (görev, danışmana bildirim...) panelden
  // eklenen müşteriyle aynı biçimde tetiklenir. Mükerrerde tetiklenmez (müşteri zaten var). Beklenmez ve
  // hata talebi asla bozmaz; modül/kural kapıları motorun içindedir. Adaya otomatik mesaj şablonu YOK.
  if (!duplicate) {
    void dispatchAutomationEvent(tenantId, "new_customer", {
      entityType: "customer",
      entityId: customerId,
      customerId,
      label: fullName,
      assignedTo,
      fields: { source, channel },
    }).catch((e) => console.error("intakeLead automation new_customer", e instanceof Error ? e.message : e));
  }

  // Form başvurusu tetikleyicisi (COM-14): mükerrer müşteri dahil HER başvuruda; kural + müşteri başına saatte bir.
  void dispatchAutomationEvent(tenantId, "lead_form_submitted", {
    entityType: "customer",
    entityId: customerId,
    customerId,
    propertyId: listing?.id ?? null,
    label: fullName,
    assignedTo,
    fields: {
      source,
      channel,
      is_new_contact: duplicate ? "hayir" : "evet",
      has_property: listing ? "evet" : "hayir",
      after_hours: withinBusinessHours(now()) ? "hayir" : "evet",
    },
  }).catch((e) => console.error("intakeLead automation lead_form_submitted", e instanceof Error ? e.message : e));

  return { ok: true, customerId, assignedTo, duplicate };
}
