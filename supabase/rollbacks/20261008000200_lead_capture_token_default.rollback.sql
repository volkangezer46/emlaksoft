-- 20261008000200 geri alma: yalnız varsayılan kaldırılır; üretilmiş tokenler yerinde kalır (vitrin formları çalışmaya devam eder).
alter table public.tenants alter column lead_capture_token drop default;
