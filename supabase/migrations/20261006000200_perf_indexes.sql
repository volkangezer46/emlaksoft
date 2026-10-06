-- Performance indexes for dashboard and list page queries
-- These indexes optimize common filtering patterns across the application
-- All indexes use CONCURRENTLY where possible and include partial indexes for active records

-- Deals: tenant + stage + updated_at (common filtering in dashboard and reports)
CREATE INDEX CONCURRENTLY idx_deals_tenant_stage_date
  ON deals(tenant_id, stage, updated_at DESC)
  WHERE deleted_at IS NULL;

-- Calls: tenant + assigned_to + started_at (team filtering, call history)
CREATE INDEX CONCURRENTLY idx_calls_tenant_assigned_date
  ON calls(tenant_id, assigned_to, started_at DESC)
  WHERE deleted_at IS NULL;

-- Tasks: tenant + user + due_date (personal task list, priority)
CREATE INDEX CONCURRENTLY idx_tasks_tenant_user_due
  ON tasks(tenant_id, user_id, due_date)
  WHERE deleted_at IS NULL;

-- Contacts: tenant + phone (duplicate detection, phone search)
CREATE INDEX CONCURRENTLY idx_contacts_tenant_phone
  ON contacts(tenant_id, phone)
  WHERE deleted_at IS NULL;

-- Events: tenant + event_date (calendar views, timeline)
CREATE INDEX CONCURRENTLY idx_events_tenant_date
  ON events(tenant_id, event_date DESC)
  WHERE deleted_at IS NULL;

-- Expenses: tenant + expense_type + created_at (accounting reports)
CREATE INDEX CONCURRENTLY idx_expenses_tenant_type_date
  ON expenses(tenant_id, expense_type, created_at DESC)
  WHERE deleted_at IS NULL;

-- Demands: tenant + status + created_at (pipeline views, filtering)
CREATE INDEX CONCURRENTLY idx_demands_tenant_status_date
  ON demands(tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- Offers: tenant + status + created_at (offer tracking, pipeline)
CREATE INDEX CONCURRENTLY idx_offers_tenant_status_date
  ON offers(tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
