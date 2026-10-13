/**
 * anon rolüne (oturumsuz PostgREST `/rpc/` ve RLS ifadeleri) BİLEREK açık public fonksiyonlar.
 *
 * `scripts/check-function-acl.ts` public şemada anon'un EXECUTE edebildiği her fonksiyonu bu listeyle karşılaştırır;
 * listede olmayan her fonksiyon HATA'dır. Tetikleyici fonksiyonları (RETURNS trigger / event_trigger) RPC olarak
 * çağrılamadığı için denetim dışıdır ve burada yer almaz.
 *
 * Anahtar: `oid::regprocedure` metni (search_path = pg_catalog altında, şema önekli; ör. `public.fold_tr(text)`).
 * Kaynak: migration zincirinin sıfırdan kurulumu (scripts/db-shadow-replay.sh, 2026-10-13) — yani migration'ların
 * niyet ettiği durum. Yeni bir anon RPC ekleyen migration bu listeye gerekçesiyle birlikte eklenmelidir.
 *
 * GEREKÇE SINIFLARI
 *  - rls-yardimci : RLS ifadelerinde çağrılır; anon sorgusunda politika değerlendirilirken EXECUTE gerekir.
 *                   Kimlik yoksa NULL/false döner (JWT claim'inden okur).
 *  - saf          : tablo okumayan/yazmayan IMMUTABLE/STABLE yardımcı (biçimlendirme, maskeleme, aralık hesabı).
 *  - invoker-rls  : SECURITY INVOKER; okuduğu tablolar RLS'e tabidir, anon için boş/NULL döner.
 *  - token        : SECURITY DEFINER ama yetkiyi parametredeki gizli token/anahtar özetiyle doğrular (public portal).
 *  - public-veri  : herkese açık veri (vitrin, kur tablosu) döndürür.
 *  - incelenecek  : açık kalması bilinçli değil gibi görünüyor ama migration zinciri böyle kuruyor; ayrı işte daraltılmalı.
 */
export type AnonAllowReason = "rls-yardimci" | "saf" | "invoker-rls" | "token" | "public-veri" | "incelenecek";

export const ANON_FUNCTION_ALLOWLIST: Readonly<Record<string, { reason: AnonAllowReason; note: string }>> = {
  // --- RLS yardımcıları ---
  "public.current_tenant_id()": { reason: "rls-yardimci", note: "JWT tenant_id; tüm politikaların temeli" },
  "public.is_platform_staff()": { reason: "rls-yardimci", note: "platform personeli politikaları; anon için false" },
  "public.current_user_scope()": { reason: "rls-yardimci", note: "kapsam politikaları (PB40)" },
  "public.current_user_team_id()": { reason: "rls-yardimci", note: "kapsam politikaları (PB40)" },
  "public.current_user_branch_id()": { reason: "rls-yardimci", note: "kapsam politikaları (PB40)" },
  "public.has_permission_with_scope(text,text,text,uuid)": { reason: "rls-yardimci", note: "kapsamlı izin politikaları; auth.uid() yoksa false" },

  // --- Saf yardımcılar ---
  "public.normalize_tr_phone(text)": { reason: "saf", note: "telefon normalizasyonu" },
  "public.fold_tr(text)": { reason: "saf", note: "Türkçe harf katlama (arama)" },
  "public.mask_name(text)": { reason: "saf", note: "ad maskeleme" },
  "public.mask_phone(text)": { reason: "saf", note: "telefon maskeleme" },
  "public.support_first_response_interval(text)": { reason: "saf", note: "destek SLA aralığı" },
  "public.support_resolution_interval(text)": { reason: "saf", note: "destek SLA aralığı" },
  "public.support_sla_warning_interval(interval)": { reason: "saf", note: "destek SLA aralığı" },
  "public.comparable_feature_desirability(integer,integer,text,text)": { reason: "saf", note: "emsal motoru puan fonksiyonu" },
  "public.media_file_name_looks_like_document(text)": { reason: "saf", note: "dosya adı sınıflandırma" },
  "public.pm_charge_due_date(date,integer)": { reason: "saf", note: "kira vade günü hesabı" },
  "public.portal_customer_request_ready()": { reason: "saf", note: "hazırlık yoklaması; sabit true" },

  // --- SECURITY INVOKER, RLS'e tabi ---
  "public.region_stats(uuid,text,integer)": { reason: "invoker-rls", note: "properties RLS; anon boş" },
  "public.find_duplicate_customers(uuid)": { reason: "invoker-rls", note: "customers RLS; anon boş" },
  "public.document_storage_usage()": { reason: "invoker-rls", note: "customer_files/property_media RLS" },
  "public.document_health_counts()": { reason: "invoker-rls", note: "customers/properties RLS" },
  "public.find_comparables(uuid,uuid,text,text,numeric,uuid,integer,integer,integer,integer,text,text)": { reason: "invoker-rls", note: "emsal motoru; properties RLS" },
  "public.estimate_property_value(uuid,uuid,text,text,numeric,uuid,integer,integer,text,text)": { reason: "invoker-rls", note: "emsal motoru; properties RLS" },
  "public.portfolio_counts(uuid[],text[],text[],text[],text[],text[],text[],timestamp with time zone)": { reason: "invoker-rls", note: "auth.uid() yoksa NULL" },
  "public.task_counts(uuid[],timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,text[])": { reason: "invoker-rls", note: "auth.uid() yoksa NULL" },
  "public.deal_side_reads(uuid)": { reason: "invoker-rls", note: "auth.uid() yoksa NULL" },
  "public.property_region_days(uuid)": { reason: "invoker-rls", note: "auth.uid() yoksa NULL" },

  // --- Token/anahtar doğrulayan public RPC'ler ---
  "public.growth_invite_preview(text)": { reason: "token", note: "davet kodu önizleme (kayıt sayfası)" },
  "public.contract_signer_resolve_short(text)": { reason: "token", note: "kısa imza linki çözümü" },
  "public.portal_customer_request(text,text,jsonb)": { reason: "token", note: "müşteri portalı istekleri" },
  "public.decide_property_price_proposal_by_token(text,uuid,text,text)": { reason: "token", note: "malik fiyat önerisi kararı" },
  "public.portal_rent_receipt_target(text,uuid)": { reason: "token", note: "kiracı dekont yükleme hedefi" },
  "public.api_v1_list(text,text,integer,timestamp with time zone)": { reason: "token", note: "public API; p_key_hash sha256 doğrulanır" },

  // --- Herkese açık veri ---
  "public.vitrin_chat_context(text,uuid)": { reason: "public-veri", note: "vitrin sohbeti; yalnız yayındaki ilan + açık ayar" },
  "public.tcmb_rate_on(date)": { reason: "public-veri", note: "TCMB kurları (kiracıdan bağımsız)" },

  // --- İncelenecek (zincir böyle kuruyor; davranışta kiracı sınırı içeride var) ---
  "public.increment_template_usage(uuid)": { reason: "incelenecek", note: "DEFINER; tenant_id = current_tenant_id() ile sınırlı, anon için etkisiz" },
  "public.aidat_kpi()": { reason: "incelenecek", note: "DEFINER; gövde current_tenant_id() ile sınırlı, anon için sıfırlar" },
};
