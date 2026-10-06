# Access Control (Erişim Kontrol) Sistemi

Kapsam (scope) temelli, hiyerarşik erişim kontrolü. Danışmanlar, takım liderleri, şube müdürleri ve ofis sahipleri için veri erişimi sınırlaması.

## Hızlı Başlangıç

### Server Action'da Kapsam Kontrolü

```typescript
import { requireScopePermission } from "@/lib/access-control";

export async function viewDemand(demandId: string) {
  // Rol × modül × aksiyon + scope kontrol
  const gate = await requireScopePermission("demands", "view", {
    resourceType: "demand",
    resourceId: demandId,
  });

  if (!gate.ok) return { error: gate.error };

  // Danışmanlar sadece atandığı talepleri görebilir (DB RLS)
  // override varsa kontrol edilir
  const demand = await db
    .from("demands")
    .select("*")
    .eq("id", demandId)
    .single();

  return { ok: true, demand, scope: gate.scope };
}
```

### Kullanıcı Kapsamını Yükleme

```typescript
import { getUserScope } from "@/lib/access-control";

const userScope = await getUserScope(userId, tenantId, role);

console.log(userScope.scope_type); // "user", "team", "branch", "office", "platform"
console.log(userScope.team_id); // Team lideri için doldurulur
console.log(userScope.can_view_all_data); // true = office/platform
```

### Scope Override'ı Kontrol Etme

```typescript
import { loadScopeOverrides, checkScopeOverride } from "@/lib/access-control";

const overrides = await loadScopeOverrides(userId, tenantId);
const allowed = checkScopeOverride(overrides, "demand", demandId);

if (allowed === true) {
  // Açık izin
} else if (allowed === false) {
  // Açık reddi
} else if (allowed === null) {
  // Override yok, normal kurallar geçerli
}
```

### SQL: Kapsam-Aware Yetkilendirme

```sql
-- TypeScript'ten çağrılabilir
SELECT has_permission_with_scope('demands', 'view', 'demand', demand_id::uuid);

-- Danışmanın talep ID'sini kontrol et
SELECT * FROM demands
WHERE id = $1
  AND has_permission_with_scope('demands', 'view', 'demand', id);

-- Takım lidisinin takım verilerine erişimi
SELECT current_user_team_id(); -- UUID döner

-- Şube müdürü şubesi
SELECT current_user_branch_id(); -- UUID döner

-- Scope türü
SELECT current_user_scope(); -- 'user', 'team', 'branch', 'office', 'platform'
```

---

## Modül Yapısı

```
src/lib/access-control/
├── types.ts              # Type tanımları
├── scope-rules.ts        # Erişim kuralları
├── scope-cache.ts        # Önbellek (getUserScope, loadScopeOverrides)
├── require-scope.ts      # Server action kapısı (requireScopePermission)
├── scope-rules.test.ts   # Unit testler (DOGRULANMADI)
├── CONTRACT.md           # Sözleşme (detaylı açıklama)
├── README.md             # Bu dosya
└── index.ts              # Exports

supabase/migrations/
├── 20261006000100_user_scopes.sql
├── 20261006000101_scope_overrides.sql
├── 20261006000102_access_audit_log.sql
└── 20261006000103_has_permission_with_scope_rpc.sql

supabase/rollbacks/
├── 20261006000100_user_scopes.rollback.sql
├── 20261006000101_scope_overrides.rollback.sql
├── 20261006000102_access_audit_log.rollback.sql
└── 20261006000103_has_permission_with_scope_rpc.rollback.sql

docs/design/
└── ACCESS_CONTROL_DESIGN.md  # Tasarım dokümanı
```

---

## Kapsam (Scope) Türleri

| Scope | Rol | Veri Erişimi | Örnek |
|---|---|---|---|
| **user** | advisor, call_center | Kendi verileri | Danışman kendi talepleri |
| **team** | team_lead | Takım verileri | Takım lideri takımın tüm talepleri |
| **branch** | branch_manager | Şube verileri | Şube müdürü şubesinin tüm verisi |
| **office** | owner, gm, accounting | Ofis verileri | Ofis sahibi tüm ofis |
| **platform** | super_admin | Platform verileri | Super admin tüm platform |

---

## Danışman (`advisor` role) Kısıtlamaları

### Talep (Demand)
```typescript
// Danışman sadece atandığı talepleri görebilir
// DB RLS: WHERE assigned_to = auth.uid()

const gate = await requireScopePermission("demands", "view", {
  resourceType: "demand",
  resourceId: demandId,
});
// gate.ok = false danışman atanmamışsa
```

### Portföy (Property)
```typescript
// Danışman sadece müşteriye ait/atandığı portföyleri görebilir
// DB RLS: WHERE assigned_to = auth.uid() OR customer.advisor_id = auth.uid()

const gate = await requireScopePermission("properties", "view", {
  resourceType: "property",
  resourceId: propertyId,
});
```

### Anlaşma (Deal) İmzalama
```typescript
// Sadece talep sahibi, takım lideri, gm, owner imzalayabilir

const gate = await requireScopePermission("contracts", "edit", {
  resourceType: "deal",
  resourceId: dealId,
  action: "sign", // requireScopePermission'a geçmeli
});

// canSignDeal() kuralı kontrol eder
```

### Komisyon Reddi
```typescript
// Sadece takım lideri ve üstü reddedebilir

const gate = await requireScopePermission("commissions", "edit", {
  resourceType: "commission",
  resourceId: commissionId,
  action: "reject",
});
```

---

## Takım Lideri (`team_lead`) Yetkileri

### Takım Verileri
```typescript
// Takım lideri kendi takımının tüm verilerini görebilir

const scope = await getUserScope(userId, tenantId, "team_lead");
console.log(scope.team_id); // Doldurulmuş
console.log(scope.scope_type); // "team"

// SQL: WHERE team_id = current_user_team_id()
```

### Talep Başı Atama
```typescript
// Takım lideri takımındaki danışmanlara talep atayabilir

const gate = await requireScopePermission("demands", "edit", {
  resourceType: "task", // talep başı atama
  targetTeamId: teamId,
  action: "assign", // Custom action (normal matrix dışı)
});

if (gate.ok && gate.scope === "team") {
  // Atama yapabilir
}
```

### Takım Raporu
```typescript
// Takım lideri takımının performans raporunu görebilir
// Bireysel danışman kazancı GIZLI (privacy)
```

---

## Şube Müdürü (`branch_manager`) Yetkileri

### Şube Verileri
```typescript
// Şube müdürü kendi şubesinin tüm verilerini görebilir

const scope = await getUserScope(userId, tenantId, "branch_manager");
console.log(scope.branch_id); // Doldurulmuş
console.log(scope.scope_type); // "branch"

// SQL: WHERE branch_id = current_user_branch_id()
```

---

## Scope Override'ları

Geçici istisnalar (danışman X talep Y'yi görebilir gibi):

### Oluşturma
```typescript
// Admin/Server Action (DB'ye direkt)
INSERT INTO scope_overrides (
  tenant_id, user_id, resource_type, resource_id, 
  allowed, reason, created_by
) VALUES (
  'office-1', 'advisor-1', 'demand', 'demand-1',
  true, 'Müdür tarafından atandı', 'gm-1'
);
```

### Kontrol (TypeScript)
```typescript
const overrides = await loadScopeOverrides(userId, tenantId);
const allowed = checkScopeOverride(overrides, "demand", demandId);

// true = açık izin, false = açık reddi, null = override yok
```

### Kontrol (SQL)
```sql
-- RPC otomatik kontrol eder
SELECT has_permission_with_scope('demands', 'view', 'demand', demand_id::uuid);
-- override varsa onu kullanır
```

---

## Denetim Günlüğü

Her yetki değişimi `access_audit_log` tablosuna kaydedilir:

```typescript
// Admin > Ayarlar > Yetkilendirme > Denetim Günlüğü
const logs = await db
  .from("access_audit_log")
  .select("*")
  .eq("tenant_id", tenantId)
  .order("created_at", { ascending: false })
  .limit(100);

// change_type: scope_created, scope_updated, override_created, vb
// details: JSON içinde eski/yeni değer
// created_by: Kimi yaptı
// reason: Neden
```

---

## SQL RLS Politikası Örneği

```sql
-- Danışman sadece kendi talepleri görebilir
CREATE POLICY advisor_demands ON demands FOR SELECT
  USING (
    tenant_id = current_tenant_id() 
    AND (
      assigned_to = auth.uid() 
      OR created_by = auth.uid()
      OR EXISTS(
        SELECT 1 FROM scope_overrides
        WHERE user_id = auth.uid()
          AND tenant_id = demands.tenant_id
          AND resource_type = 'demand'
          AND resource_id = demands.id
          AND allowed = true
          AND (expires_at IS NULL OR expires_at > now())
      )
    )
  );

-- Takım lideri takımın talepleri
CREATE POLICY team_lead_demands ON demands FOR SELECT
  USING (
    tenant_id = current_tenant_id() 
    AND team_id = current_user_team_id()
  );

-- Şube müdürü şubenin talepleri
CREATE POLICY branch_manager_demands ON demands FOR SELECT
  USING (
    tenant_id = current_tenant_id() 
    AND branch_id = current_user_branch_id()
  );
```

---

## Test

### Unit Test
```bash
npm run test -- src/lib/access-control/scope-rules.test.ts
```

### SQL Contract Test (gelecek)
```bash
npm run test -- src/lib/access-control/has-permission-with-scope.test.ts
```

### E2E Test (gelecek)
```bash
npm run test:e2e -- access-control.spec.ts
```

---

## Performance

- **Caching:** `getUserScope` ve `loadScopeOverrides` `cache()` decorator ile istek başına bir kez çalışır.
- **Database:** `scope_overrides` tabliosu indexed (tenant_user, resource_type, expires_at).
- **RLS:** Her query'ye policy check; N+1 sorunları mümkün (pagination dikkat).

---

## Bilinen Sorunlar & TODO

- [ ] RLS politikaları mevcut tablolara eklenmesi (demands, properties, deals, commissions)
- [ ] Nav'a "Yetkilendirme" modülü eklenmesi (`/app/ayarlar/yetkilendirme`)
- [ ] UI bileşenleri (scope yönetimi, override yönetimi)
- [ ] Server actions (scope/override oluştur/güncelle/sil)
- [ ] E2E testler
- [ ] Denetim dashboard
- [ ] Cron yetkilendirme kontrol

---

## Kaynaklar

- **Tasarım:** `docs/design/ACCESS_CONTROL_DESIGN.md`
- **Sözleşme:** `src/lib/access-control/CONTRACT.md`
- **Mevcut RBAC:** `src/lib/permissions.ts`
- **Server Action Kapısı:** `src/lib/require-permission.ts`
- **Mevcut Tenant Kontrol:** `src/lib/tenant-guard.ts`

---

## FAQ

**S: Danışman diğer danışmanın taleplerini görebilir mi?**  
C: Hayır, sadece kendi talepleri (assigned_to). Override ile izin verilebilir.

**S: Takım lideri diğer takımı görebilir mi?**  
C: Hayır, sadece kendi takımı (team_id). GM/owner tüm takımları görebilir.

**S: Override süresi dolduğunda ne olur?**  
C: Otomatik yok sayılır. Yeniden override oluşturulması gerekir.

**S: Danışman kazançını görebilir mi?**  
C: Hayır, privacy kuralı (dashboard'da "Earnings" açık değilse).

**S: Commission reddi kim yapabilir?**  
C: Takım lideri ve üstü (takım_lead, branch_manager, gm, owner).

**S: Database'de rollback için ne yapılır?**  
C: `supabase/rollbacks/` dosyalarını uygula (ters sırada).
