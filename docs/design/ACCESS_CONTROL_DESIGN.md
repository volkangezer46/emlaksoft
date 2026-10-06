# Kapsam Temelli Erişim Kontrol (RBAC+Scope) Tasarımı

**Tarih:** 2026-10-06  
**Durum:** TASARLANMADI — Test/lint/build koşulmadı  
**İlgili Modül:** `access-control` (yeni)

---

## Amaç

EmlakSoft'ta danışmanlar, takım liderleri, şube müdürleri ve ofis sahipleri için **hiyerarşik veri erişimi** sağlamak. Mevcut rol × modül × aksiyon matrisine (RBAC) **kapsam (scope)** katmanı eklemek.

### Örnek Senaryolar

1. **Danışman X, talep Y'yi görebilir mi?**
   - Cevap: Evet, eğer `demands.assigned_to = X` (DB RLS)
   - İstisna: `scope_overrides` tablosunda override varsa

2. **Danışman Y anlaşma Z'yi imzalayabilir mi?**
   - Cevap: Evet, eğer talep sahibi (+ takım lideri/gm/owner da yapabilir)
   - Kontrol: `canSignDeal` kuralı + DB yetkilendirme

3. **Takım lideri W takım verilerini görebilir mi?**
   - Cevap: Evet, takımının tüm talepleri (`WHERE team_id = current_user.team_id`)
   - Rapor: Takım özeti, bireysel kazanç GIZLI

4. **Şube müdürü, diğer şubeyi yönetebilir mi?**
   - Cevap: Hayır, sadece kendi şubesi (`WHERE branch_id = current_user.branch_id`)

---

## Mimari

### 1. Hiyerarşi

```
user (danışman, call_center)
  ↓
team (takım lideri)
  ↓
branch (şube müdürü)
  ↓
office (ofis sahibi, gm)
  ↓
platform (super_admin)
```

Yukarıya doğru daha geniş yetki (office tüm office'i görebilir).

### 2. Tablolar

#### `user_scopes` — Kullanıcı kapsam tanımları
- **Alanlar:**
  - `tenant_id`, `user_id`, `scope_type` (user/team/branch/office/platform)
  - `team_id` (team_lead için), `branch_id` (branch_manager için)
  - `can_view_all_data`, `can_edit_team_members`, `can_override_permissions`, `can_see_earnings`
  - `created_by`, `updated_by`, `created_at`, `updated_at`

- **RLS:**
  - Read: Authenticated kendi tenant'ını okur
  - Write: Owner/gm yazabilir

- **Seed:**
  - Role göre varsayılan scope; danışmanlar = "user", takım liderler = "team", vb.

#### `scope_overrides` — Geçici istisnalar
- **Alanlar:**
  - `tenant_id`, `user_id`, `resource_type`, `resource_id`
  - `allowed` (true = ek izin, false = reddi)
  - `reason`, `expires_at`, `created_by`, `created_at`

- **RLS:**
  - Read: Authenticated kendi tenant'ını okur
  - Write: Owner/gm yazabilir

- **Semantik:**
  - `allowed = true` → danışman X talep Y'yi görebilir
  - `allowed = false` → danışman X talep Y'yi göremez (override)
  - `expires_at` → süreli izin; geçmiş satırlar yok sayılır

#### `access_audit_log` — Denetim günlüğü
- **Alanlar:**
  - `tenant_id`, `user_id`, `change_type`
  - `details` (JSON), `reason`, `created_by`, `created_at`

- **Türler:**
  - `scope_created`, `scope_updated`, `scope_deleted`
  - `override_created`, `override_updated`, `override_deleted`
  - `permission_granted`, `permission_revoked`

- **RLS:**
  - Read: Owner/gm sadece logları okur
  - Write: Service_role (triggers)

### 3. SQL RPC Fonksiyonları

#### `public.current_user_scope() → text`
Geçerli kullanıcının scope türünü döndürür (user, team, branch, office, platform).

#### `public.current_user_team_id() → uuid`
Geçerli kullanıcının takım ID'si (team_lead için).

#### `public.current_user_branch_id() → uuid`
Geçerli kullanıcının şube ID'si (branch_manager için).

#### `public.has_permission_with_scope(module, action, resource_type, resource_id) → boolean`
Kapsam-aware yetkilendirme kontrolü:
1. Rol × modül × aksiyon (temel)
2. Resource-specific kapsam kuralları:
   - Danışman talep: sadece `assigned_to = current_user`
   - Danışman portföy: sadece atandığı/müşteriye ait
   - Anlaşma imzalama: talep sahibi veya manager
   - vb.
3. Override kontrol: `scope_overrides` tablosunda izin varsa geçerlidir.

### 4. TypeScript Katmanı

#### `src/lib/access-control/types.ts`
- `AccessScope`, `UserScope`, `ScopeOverride`, `AccessDecision`, `ScopePermissionContext`

#### `src/lib/access-control/scope-rules.ts`
- `getDefaultScopeForRole(role) → AccessScope`
- `canAdvisorAccessDemand(context) → AccessDecision`
- `canSignDeal(context) → AccessDecision`
- `evaluateScopeAccess(context) → AccessDecision`
- vb.

#### `src/lib/access-control/scope-cache.ts`
- `getUserScope(userId, tenantId, role) → UserScope`
- `loadScopeOverrides(userId, tenantId) → Map<key, boolean>`
- `checkScopeOverride(overrides, resourceType, resourceId) → boolean | null`
- Cache() ile istek başına bir kez çalışır

#### `src/lib/access-control/require-scope.ts`
- `requireScopePermission(mod, action, scopeContext) → ScopePermissionGate`
- `requirePermission` üzerine built-in
- Scope kontrol ekler

---

## Danışman Kısıtlamaları

### Talep (Demand)
- **Görebildiği:** Atandığı talepleri (`assigned_to = self`)
- **RLS:** `WHERE assigned_to = auth.uid()`
- **Override:** `scope_overrides` ile müdür izni verebilir

### Portföy (Property)
- **Görebildiği:** Atandığı/müşteriye ait portföyleri
- **RLS:** `WHERE assigned_to = auth.uid() OR customer_id IN (SELECT customer_id FROM customer_advisor_links WHERE advisor_id = auth.uid())`
- **Düzenleme:** YAPAMAZ (normal permission matrix'ine bağlı)

### Anlaşma (Deal)
- **Görebildiği:** Talep sahibiyse (takım lideri/gm/owner da)
- **İmzalama:** Sadece talep sahibi
- **RLS:** Talep ID'ye bakılır

### Komisyon (Commission)
- **Görüntüleme:** Kendi verisi
- **Reddetme:** Takım lideri ve üstü

### Rapor (Report)
- **Görüntüleme:** Kendi raporu (danışman verileri)
- **Filtre:** `WHERE advisor_id = auth.uid()`

---

## Takım Lideri Yetkileri

- **Kapsam:** `team` (takımının tüm talep/portföy/anlaşma/görevleri)
- **Takım verilerini görebilir:** Evet (`WHERE team_id = current_user.team_id`)
- **Talep başı atama:** Evet (`canAssignDemandLead` kuralı)
- **Komisyon onayı:** Evet (takım verisi)
- **Rapor:** Takım özeti; bireysel kazanç GIZLI (privacy)

---

## Şube Müdürü Yetkileri

- **Kapsam:** `branch` (şubenin tüm talep/portföy/anlaşma/görevleri)
- **Şube verilerini görebilir:** Evet (`WHERE branch_id = current_user.branch_id`)
- **Rapor:** Şube özeti
- **Komisyon oranı:** Varsayılan oranı ayarlayabilir
- **Takım yönetimi:** Şube içinde

---

## Ofis Yönetimi

- **Kapsam:** `office` (hiçbir kısıtlama)
- **Tüm erişim:** Ofis verisinin tamamı
- **Yetki yönetimi:** Danışmanları, rollerini, scope'larını ayarlayabilir
- **Audit:** Erişim günlüğünü görebilir

---

## Test Stratejisi

### Unit Test (`scope-rules.test.ts`)
```typescript
describe('canAdvisorAccessDemand', () => {
  it('advisor can view own demand', () => {
    const result = canAdvisorAccessDemand({
      userId: 'A1', targetUserId: 'A1', action: 'view'
    });
    expect(result.allowed).toBe(true);
  });
});
```

### SQL Contract Test (gelecek ajanda)
- RLS politika: Danışman sadece kendi talepleri görebilir
- RPC: `has_permission_with_scope` çalışması
- Override: Geçici izin verme/alma

### E2E Test (gelecek ajanda)
- Danışman talep listesini filtrelemesi
- Talep başı atama (takım lideri)
- Anlaşma imzalama (yetkilendirilmiş)
- Rapor görüntüleme (scope filtresi)

---

## Implementation Roadmap

1. **✅ YAPILDI:** TypeScript types + kurallar + caching (`src/lib/access-control/*`)
2. **✅ YAPILDI:** SQL migration + RPC (`supabase/migrations/20261006000100-103`)
3. **❌ TODO:** Nav modülü (`src/lib/nav-config.ts` + `/app/ayarlar/yetkilendirme`)
4. **❌ TODO:** UI bileşenleri (yönetim ekranı, scope ayarları)
5. **❌ TODO:** Server actions (scope oluştur/güncelle/sil)
6. **❌ TODO:** RLS extensions (mevcut tablolara scope-aware politika)
7. **❌ TODO:** E2E testler
8. **❌ TODO:** Denetim dashboard

---

## Bilinen Sınırlamalar & Gelecek Çalışma

1. **RLS genişletme:** `demands`, `properties`, `deals`, `commissions` tablolarına scope-aware RLS politika eklenmesi gereklidir.
2. **Teams & Branches:** `teams` ve `branches` tablolarının varlığı gerekli; seed migration gerekebilir.
3. **Danışman PII:** Danışman bilgilerinin gizliliği (`src/lib/advisor/pii-crypto.ts`) ayrı kontrol.
4. **Earnings privacy:** Bireysel kazanç (earnings) danışman/takım lideri görüntülemesi sınırlı; audit gerekli.
5. **Cron permissions:** Cron işleri yetkilendirme kontrol etmez (allowlist yok); denetim yapılacak.

---

## Sahip Kararları

- **Scope sisteminin aktivasyonu:** Feature flag ile (gelecek)
- **Override süresi:** Varsayılan 30 gün (decision gerekli)
- **Danışman erişim izni:** Talep sahibiyse default; override özel karar
- **Takım/şube veri sınırı:** Sert RLS (veri sızıntısı riski: kritik)

---

## Notlar

- **Önceki yapı korunur:** `permissions.ts` MATRIX değişmez; scope sistem üzerine eklenir.
- **Mevcut izinler:** Owner/gm tüm erişimi tutar; scope sistem danışmanları, takım liderlerini sınırlandırır.
- **Performance:** Scope kontrol caching ile optimize edilir (`cache()` React decorator).
- **Güvenlik:** RLS + server action kapıları + audit log ile multi-layered.

---

## Kaynaklar

- **TypeScript:** `src/lib/access-control/` (types, rules, cache, require-scope)
- **SQL:** `supabase/migrations/20261006000100-103`
- **Test:** `src/lib/access-control/scope-rules.test.ts` (unit)
- **Sözleşme:** `src/lib/access-control/CONTRACT.md`
