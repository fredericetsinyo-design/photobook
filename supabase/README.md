# Service de validation client (Supabase)

1. Créer un projet Supabase (offre gratuite suffisante), région conseillée : `eu-west-3` (Paris) ou `eu-west-1`.
2. Appliquer la migration `migrations/20261029_photobook_proofing.sql` (éditeur SQL de Supabase, ou outil de migration).
3. Créer la clé du studio (à garder secrète, à saisir une fois dans PhotoBook → ✉ Client → Connexion au service) :

```sql
-- remplacez la clé par une longue phrase secrète
insert into public.photobook_studios (name, key_hash)
values ('Fredy Photography', public.photobook_hash('VOTRE-CLE-STUDIO-SECRETE'));
```

4. Dans Netlify (Site configuration → Environment variables), définir puis redéployer :
   - `VITE_SUPABASE_URL` = adresse du projet (https://xxxx.supabase.co)
   - `VITE_SUPABASE_ANON_KEY` = clé publique (publishable / anon)
   - `VITE_PUBLIC_APP_URL` = https://photobook-fredy.netlify.app/

La clé publique peut être visible dans l'application : toutes les tables sont fermées et seules les fonctions
protégées par la clé studio, la clé d'album ou le jeton client sont appelables.
