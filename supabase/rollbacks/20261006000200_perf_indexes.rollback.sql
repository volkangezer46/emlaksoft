-- Rollback performance indexes
DROP INDEX CONCURRENTLY IF EXISTS idx_deals_tenant_stage_date;
DROP INDEX CONCURRENTLY IF EXISTS idx_calls_tenant_assigned_date;
DROP INDEX CONCURRENTLY IF EXISTS idx_tasks_tenant_user_due;
DROP INDEX CONCURRENTLY IF EXISTS idx_contacts_tenant_phone;
DROP INDEX CONCURRENTLY IF EXISTS idx_events_tenant_date;
DROP INDEX CONCURRENTLY IF EXISTS idx_expenses_tenant_type_date;
DROP INDEX CONCURRENTLY IF EXISTS idx_demands_tenant_status_date;
DROP INDEX CONCURRENTLY IF EXISTS idx_offers_tenant_status_date;
