# pg_restore -l çıktısını süzer: public şeması (yetkiler dahil), pg_trgm, ensure_rls,
# avatar depolama politikaları ve auth/storage verisi (göç tabloları hariç).
#
# ACL girdileri ve anon REVOKE'ları: public şemasının ACL girdileri korunur, ancak bulutta
# anon'dan geri alınmış (REVOKE) yetkiler hedefte geri GELEBİLİR. Neden: pg_dump ACL'yi nesne
# türünün yerleşik varsayılanına (acldefault: sahip + PUBLIC) göre yazar; anon o varsayılanda
# olmadığından dökümde "REVOKE ... FROM anon" satırı hiç yoktur, yalnız verilen GRANT'lar vardır.
# Hedefte ise Supabase'in pg_default_acl'i (ALTER DEFAULT PRIVILEGES IN SCHEMA public ... TO anon,
# authenticated, service_role) her CREATE TABLE/FUNCTION/SEQUENCE anında anon'a yetki ekler; DEFAULT
# ACL girdisi de geri yüklemenin sonunda işlendiğinden nesneler hedefin varsayılanıyla doğar.
# Sonuç: bulutta anon'a kapalı nesne hedefte anon'a açık kalabilir (RLS yine geçerli, ama
# SECURITY DEFINER fonksiyonlar/görünümler için tehlikeli). Bu yüzden geri yüklemeden sonra ACL
# farkı WP1'in `npm run check:acl` denetimiyle kontrol edilir (restore-cloud-dump.sh sonunda çağrılır).
import re,sys
MULTI=["TABLE DATA","FK CONSTRAINT","CHECK CONSTRAINT","SEQUENCE SET","SEQUENCE OWNED BY","INDEX ATTACH","TABLE ATTACH","PUBLICATION TABLE","EVENT TRIGGER","ROW SECURITY","DEFAULT ACL","MATERIALIZED VIEW DATA","MATERIALIZED VIEW"]
out=[]
for line in open(sys.argv[1]):
    if line.startswith(';') or not line.strip(): continue
    m=re.match(r'^(\d+); (\d+) (\d+) (.*)$',line.rstrip('\n'))
    rest=m.group(4)
    typ=next((t for t in MULTI if rest.startswith(t+' ')),rest.split(' ')[0])
    tail=rest[len(typ)+1:].split(' ')
    schema=tail[0]; name=' '.join(tail[1:])
    keep=False
    if schema=='public': keep=True
    elif typ=='ACL' and (schema=='public' or name.startswith('SCHEMA public')): keep=True
    elif typ in('EXTENSION','COMMENT') and 'pg_trgm' in name: keep=True
    elif typ=='EVENT TRIGGER' and name.startswith('ensure_rls'): keep=True
    elif typ=='POLICY' and schema=='storage' and 'avatars_owner' in name: keep=True
    elif typ=='TABLE DATA' and schema=='auth' and not name.startswith('schema_migrations'): keep=True
    elif typ=='TABLE DATA' and schema=='storage' and not name.startswith('migrations'): keep=True
    # auth/storage sayaç değerleri (ör. auth.refresh_tokens_id_seq); yoksa yeni oturumlar eski kimliklerle çakışır.
    elif typ=='SEQUENCE SET' and schema in ('auth','storage'): keep=True
    if keep: out.append(line)
sys.stdout.writelines(out)
