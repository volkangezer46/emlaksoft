-- SECURITY DEFINER routines from older migrations intentionally resolve
-- application objects from the public schema. Never let request-facing roles
-- create shadow objects in that schema, even if a future database template or
-- restore changes PostgreSQL's default schema grants.
revoke create on schema public from public, anon, authenticated, service_role;

comment on schema public is
  'Application schema. CREATE is reserved for the database owner/migration role; request-facing roles receive only explicit object privileges.';
