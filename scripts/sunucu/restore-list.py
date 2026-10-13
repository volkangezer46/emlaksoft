# pg_restore -l çıktısını süzer: public şeması (yetkiler dahil), pg_trgm, ensure_rls,
# avatar depolama politikaları ve auth/storage verisi (göç tabloları hariç).
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
    if keep: out.append(line)
sys.stdout.writelines(out)
