# Kapsam (Scope) Temelli Erişim Kontrol Sistemi — Sözleşme

## Genel Bakış

EmlakSoft'ta yetkilendirme, rol × modül × aksiyon matrisi (var olan `permissions.ts`) ile başlar. Bu, **scope systemi** tarafından genişletilir: her kullanıcının veri erişiminin hiyerarşik bir "kapsamı" vardır.

**Hiyerarşi:** `user` < `team` < `branch` < `office` < `platform`

---

## GERÇEK DURUM (2026-10-10 rol duman testi, bulgu B1) — ÖNCE BUNU OKU

Bu belgenin aşağıdaki "DB RLS" / "SQL RLS" bölümleri **hedef tasarımdır; veritabanında UYGULANMAMIŞTIR**. Bugünkü davranış:

- **Kayıt kapsamı (kendi / takım / şube) yalnız UYGULAMA katmanında** uygulanır: liste sayfaları ve Rapor merkezi
  `getListScope` + `applyScopeFilter` (`list-scope.ts`) ile sorguya `assigned_to` vb. süzgeç ekler.
- **Bayrak:** `office.access.scope_enforcement` varsayılan KAPALI (hiçbir ofiste açık değil); kapalıyken
  danışman rolünün listeleri eski kurala (`mineOnly`) göre davranır.
- **RLS tarafı** (`identity_*_select`, `20260802000300_identity_session_authorization_hardening.sql`) yalnız
  `tenant_id` eşitliği + `has_effective_permission(modül, 'view')` denetler. Yani bayrak AÇIK olsa bile modül
  izni olan bir kullanıcı PostgREST ile (arayüzü atlayarak) ofisinin tüm müşteri/talep/portföy/anlaşma
  satırlarını okuyabilir. Kapsam bir **gizlilik sınırı değil, arayüz/rapor daraltmasıdır**.
- `scope_overrides` ve `has_permission_with_scope` RPC'si vardır (20261006000101/103) ama tabloların RLS
  politikalarına bağlı DEĞİLDİR.
- Kayıt düzeyinde gerçek DB zorlaması gerekirse: bayrak kapalıyken `true` dönen SECURITY DEFINER bir
  `scope_allows(tenant_id, assigned_to, team_id, branch_id)` yüklemi RLS'e eklenmeli (performans ve kapsam büyük;
  ayrı iş). O zamana dek "DB RLS" satırlarını güvence olarak okuma.
- DB'de fiilen uygulanan sınırlar: tenant izolasyonu, modül izni, komisyon kazanç gizliliği (P12),
  `audit_logs`/`error_logs`/takvim token'ı (20261010000400).

---

## Kapsam Türleri

| Scope | Rol | Erişim | Örnek |
|---|---|---|---|
| **user** | advisor, call_center | Kendi verileri | Danışman kendi talepleri, portföyleri |
| **team** | team_lead | Takım verileri | Takım lideri takımın tüm talepleri |
| **branch** | branch_manager | Şube verileri | Şube müdürü şubenin tüm verisi |
| **office** | owner, gm, accounting | Ofis verileri | Ofis sahibi tüm ofis verisi |
| **platform** | super_admin | Platform verileri | Platform yöneticisi tüm platformu |

---

## 1. Danışman Kısıtlamaları (`advisor` role)

### Talep (Demand) Erişimi
- **Kural:** Danışman sadece **atandığı talepleri** (`demands.assigned_to = current_user`) görebilir.
- **DB RLS:** SQL `WHERE assigned_to = auth.uid()` ile uygulanır.
- **Sorgulama:** Talep listesine filtreleme otomatik.
- **İstisna:** `scope_overrides` tablosunda override varsa (ör: müdür izni) geçerlidir.

### Portföy (Property) Erişimi
- **Kural:** Danışman sadece **müşteriye bağlı portföyleri** veya **atandığı portföyleri** görebilir.
- **DB RLS:** 
  ```sql
  WHERE assigned_to = auth.uid() OR 
        customer_id IN (SELECT customer_id FROM customer_advisor_links WHERE advisor_id = auth.uid())
  ```
- **Özel Durum:** Portföy detayında link var, danışman portföylere atanabilir.

### Anlaşma (Deal) Erişimi
- **Kural:** Danışman sadece **talep sahibiyse** (`demands.assigned_to = current_user`) anlaşma görebilir/düzenleyebilir.
- **Anlaşma İmzalama:** Sadece talep sahibi imzalayabilir (+ takım lideri, gm, owner).
- **DB:** `deals` ← `demands` tablosu bağlantısı; RLS demand'ı kontroler.

### Komisyon Reddi
- **Kural:** Sadece **takım lideri** ve üstü (`team_lead`, `branch_manager`, `gm`, `owner`) reddedebilir.
- **Action:** `canRejectCommission` kuralı kontroler.

### Rapor Görüntüleme
- **Kural:** Danışman sadece **kendi raporunu** görebilir (kendi verileri).
- **DB:** Raporlar aggregated SQL'den gelir; danışman filtresi `WHERE advisor_id = current_user` olmalı.

---

## 2. Takım Lideri Yetkileri (`team_lead` role)

### Takım Verileri Erişimi
- **Kural:** Takım lideri **kendi takımındaki** tüm talep/portföy/anlaşma/görevleri görebilir.
- **Kapsam:** `scope = "team"`, `team_id = current_user.team_id`.
- **DB RLS:** `WHERE team_id = current_user_team_id()` (SQL RPC).

### Talep Başı Atama
- **Kural:** Takım lideri, takımındaki danışmanlara talep atayabilir.
- **Action:** `canAssignDemandLead` kontroler.
- **DB:** `demands.assigned_to` update, team kontrol.

### Takım Raporu
- **Kural:** Takım lideri takımının performans raporunu görebilir.
- **Not:** Bireysel danışman kazancı (earnings) GIZLI kalır (privacy).

---

## 3. Şube Müdürü Yetkileri (`branch_manager` role)

### Şube Verileri Erişimi
- **Kural:** Şube müdürü **kendi şubesindeki** tüm talep/portföy/anlaşmaları görebilir.
- **Kapsam:** `scope = "branch"`, `branch_id = current_user.branch_id`.
- **DB RLS:** `WHERE branch_id = current_user_branch_id()`.

### Şube Raporu & Komisyon Oranı
- **Kural:** Şube müdürü şube performansını görebilir, varsayılan komisyon oranını ayarlayabilir.
- **Report:** `/app/raporlar` şube filtresi.

---

## 4. Ofis Yönetimi Yetkileri (`owner`, `gm`)

- **Tüm erişim:** Ofis verisinin tamamını görebilir/düzenleyebilir.
- **Scope:** `office` — hiçbir kısıtlama.
- **Yetki Yönetimi:** Rollerini, danışmanların kapsam/izinlerini ayarlayabilir.

---

## 5. Muhasebe Rolü (`accounting`)

- **Erişim:** Ofis seviyesi, ama sadece finansal verileri (komisyon, fatura, ödeme).
- **Kısıtlama:** Müşteri/talep detayı GÖRÜNTÜLEYEBILIR ama DÜZENLEYEMEZ.
- **DB:** Finansal tablo RLS, accounting okur ama yazamaz (ör: `commissions` read-only).

---

## 6. Read-Only Rolü (`readonly`)

- **Erişim:** Tüm ofis verileri, ama hiçbir yazma.
- **Durum:** Platform support (impersonation) sırasında kullanılır.

---

## Veri Seviyesi Kontrol Mekanizmaları

### 1. SQL RLS (Row-Level Security)

Her tablo, scope-aware RLS politikaları ile korunur:

```sql
-- Danışman: sadece kendi talepleri
CREATE POLICY advisor_demands ON demands FOR SELECT
  USING (tenant_id = current_tenant_id() AND assigned_to = auth.uid());

-- Takım lideri: takımın talepleri
CREATE POLICY team_lead_demands ON demands FOR SELECT
  USING (tenant_id = current_tenant_id() 
    AND team_id = current_user_team_id());

-- Scope override kontrol
CREATE POLICY scope_override_demands ON demands FOR SELECT
  USING (... OR EXISTS(
    SELECT 1 FROM scope_overrides 
    WHERE user_id = auth.uid() AND resource_type = 'demand' 
      AND resource_id = demands.id AND allowed = true
  ));
```

### 2. Server Action Kapıları (`requireScopePermission`)

```typescript
// TypeScript server action
const gate = await requireScopePermission("demands", "view", {
  resourceType: "demand",
  resourceId: demandId,
});

if (!gate.ok) return error(gate.error);
```

### 3. PostgreSQL RPC Fonksiyonları

```sql
-- Kapsam-aware yetkilendirme kontrolü
SELECT has_permission_with_scope('demands', 'view', 'demand', demand_id::uuid);
```

---

## Scope Override'ları (`scope_overrides` tablosu)

Geçici istisnalar için kullanılır:

```sql
INSERT INTO scope_overrides 
  (tenant_id, user_id, resource_type, resource_id, allowed, reason, created_by)
VALUES 
  (office_id, advisor_id, 'demand', demand_id, true, 
   'Müdür tarafından talep atandı', gm_id);
```

- **allowed = true:** Ek erişim izni
- **allowed = false:** Erişim reddi (geri alma)
- **expires_at:** NULL = sınırsız; date = geçici
- **DB RLS:** Kontroller `has_permission_with_scope` RPC'sinde

---

## Denetim Günlüğü (`access_audit_log`)

Her yetki değişimi kaydedilir:

```sql
INSERT INTO access_audit_log
  (tenant_id, user_id, change_type, details, reason, created_by)
VALUES
  (office_id, advisor_id, 'scope_created', 
   '{"scope_type": "user", ...}',
   'Danışman onboarding',
   gm_id);
```

---

## Test Kontratı

### 1. `scope-rules.test.ts` — Unit Test
- Rol → scope mapping
- Danışman erişim kuralları
- Anlaşma imzalama kontrol
- Komisyon reddi kontrol

### 2. SQL Contract Test (gelecek ajanda)
- RLS politikaları
- `has_permission_with_scope` RPC'si
- Override kontrolü

### 3. E2E Test (gelecek ajanda)
- Danışman talep listesini görebilir
- Talep başı atama (takım lideri)
- Anlaşma imzalama (esas + müdür)
- Raporlar (kapsam filtresi)

---

## Implementation Notes

1. **Mevcut yapı korunur:** `permissions.ts` MATRIX ve `requirePermission` değişmez.
2. **Scope sistem yukarıya eklenir:** `requireScopePermission` = `requirePermission` + scope kontrol.
3. **Teams tablosu gerekli:** `team_lead` scope'u için `teams` tablosu + `profiles.team_id` ilişkisi.
4. **Branches tablosu gerekli:** `branch_manager` scope'u için `branches` + `profiles.branch_id`.
5. **SQL RLS:** Her tabloyu scope-aware yapmak ayrı migration'lar gerektiriyor (forward-only).
6. **Denetim:** Tüm scope değişiklikleri `access_audit_log` kaydedilir.

---

## Sonraki Adımlar (Ajanlar)

1. **Nav + yönetim UI:** `/app/ayarlar/yetkilendirme` (yeni modül `access-control`).
2. **RLS extensions:** Mevcut tablolara scope-aware politika ekleme.
3. **Server actions:** Yetkilendirme yönetimi (scope oluştur/güncelle/sil).
4. **E2E testler:** Danışman kısıtlamalarını doğrula.
5. **Denetim dashboard:** Admin'de erişim günlüğü görüntüleme.
