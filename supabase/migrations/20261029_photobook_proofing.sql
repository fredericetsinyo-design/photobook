-- PhotoBook — validation des albums par les clients.
-- Principe : toutes les tables sont privées (RLS activée, aucune politique) ; l'accès passe uniquement
-- par des fonctions SECURITY DEFINER qui vérifient un secret :
--   • clé studio  : le photographe (une clé par studio, gardée dans l'application) ;
--   • clé album   : le photographe, pour un album donné (gardée avec le projet) ;
--   • jeton client: le client, pour SON album uniquement (dans le lien envoyé).
-- Les secrets ne sont jamais stockés en clair : seule leur empreinte SHA-256 est conservée.
-- Les pages envoyées sont des épreuves basse résolution filigranées ; les originaux ne quittent jamais l'appareil.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.photobook_studios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.photobook_albums (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.photobook_studios(id) on delete cascade,
  token_hash text not null unique,
  owner_hash text not null,
  title text not null,
  client_name text not null default '',
  client_email text not null default '',
  message text not null default '',
  watermark text not null default '',
  allow_comments boolean not null default true,
  page_count int not null default 0 check (page_count between 0 and 300),
  status text not null default 'draft' check (status in ('draft', 'sent', 'viewed', 'validated', 'changes')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count int not null default 0,
  decided_at timestamptz,
  client_note text not null default ''
);

create table if not exists public.photobook_album_pages (
  album_id uuid not null references public.photobook_albums(id) on delete cascade,
  page_no int not null check (page_no >= 1),
  width int not null,
  height int not null,
  image text not null, -- JPEG en base64 (épreuve filigranée, ~1600 px)
  status text check (status in ('ok', 'change')),
  primary key (album_id, page_no)
);

create table if not exists public.photobook_comments (
  id bigint generated always as identity primary key,
  album_id uuid not null references public.photobook_albums(id) on delete cascade,
  page_no int not null,
  x real check (x between 0 and 1),
  y real check (y between 0 and 1),
  body text not null check (char_length(body) between 1 and 2000),
  author text not null default '',
  from_client boolean not null default true,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists photobook_comments_album on public.photobook_comments(album_id, page_no);
create index if not exists photobook_albums_studio on public.photobook_albums(studio_id, created_at desc);

alter table public.photobook_studios enable row level security;
alter table public.photobook_albums enable row level security;
alter table public.photobook_album_pages enable row level security;
alter table public.photobook_comments enable row level security;
revoke all on public.photobook_studios, public.photobook_albums, public.photobook_album_pages, public.photobook_comments from anon, authenticated;

-- ---------- outils internes ----------
create or replace function public.photobook_hash(p text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(coalesce(p, ''), 'sha256'), 'hex')
$$;

create or replace function public.photobook_secret() returns text
language sql volatile set search_path = public, extensions as $$
  select translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_')
$$;

create or replace function public.photobook_studio(p_key text) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare v uuid;
begin
  select id into v from photobook_studios where key_hash = photobook_hash(p_key);
  if v is null then raise exception 'Clé studio invalide' using errcode = '28000'; end if;
  return v;
end $$;

create or replace function public.photobook_owned(p_album uuid, p_owner text) returns photobook_albums
language plpgsql stable security definer set search_path = public, extensions as $$
declare a photobook_albums;
begin
  select * into a from photobook_albums where id = p_album and owner_hash = photobook_hash(p_owner);
  if a.id is null then raise exception 'Album introuvable ou clé album invalide' using errcode = '28000'; end if;
  return a;
end $$;

create or replace function public.photobook_client(p_token text) returns photobook_albums
language plpgsql stable security definer set search_path = public, extensions as $$
declare a photobook_albums;
begin
  select * into a from photobook_albums where token_hash = photobook_hash(p_token) and status <> 'draft';
  if a.id is null then raise exception 'Lien invalide' using errcode = '28000'; end if;
  if a.expires_at < now() then raise exception 'Ce lien a expiré. Demandez un nouveau lien à votre photographe.' using errcode = '28000'; end if;
  return a;
end $$;

-- ---------- photographe ----------
create or replace function public.photobook_create_album(
  p_studio_key text, p_title text, p_client_name text, p_client_email text, p_message text,
  p_watermark text, p_allow_comments boolean, p_expires_days int, p_page_count int
) returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare s uuid := photobook_studio(p_studio_key); tok text := photobook_secret(); own text := photobook_secret(); aid uuid;
begin
  insert into photobook_albums (studio_id, token_hash, owner_hash, title, client_name, client_email, message, watermark,
    allow_comments, page_count, expires_at)
  values (s, photobook_hash(tok), photobook_hash(own), left(coalesce(p_title, 'Album'), 200), left(coalesce(p_client_name, ''), 200),
    left(coalesce(p_client_email, ''), 320), left(coalesce(p_message, ''), 4000), left(coalesce(p_watermark, ''), 120),
    coalesce(p_allow_comments, true), greatest(0, least(300, coalesce(p_page_count, 0))),
    now() + make_interval(days => greatest(1, least(365, coalesce(p_expires_days, 30)))))
  returning id into aid;
  return json_build_object('album_id', aid, 'client_token', tok, 'owner_key', own);
end $$;

create or replace function public.photobook_put_page(p_album uuid, p_owner text, p_page_no int, p_width int, p_height int, p_image text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_owned(p_album, p_owner);
begin
  if p_page_no < 1 or p_page_no > a.page_count then raise exception 'Numéro de page invalide'; end if;
  if length(p_image) > 4000000 then raise exception 'Image trop lourde'; end if;
  insert into photobook_album_pages (album_id, page_no, width, height, image) values (a.id, p_page_no, p_width, p_height, p_image)
  on conflict (album_id, page_no) do update set width = excluded.width, height = excluded.height, image = excluded.image, status = null;
end $$;

create or replace function public.photobook_publish(p_album uuid, p_owner text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_owned(p_album, p_owner); n int;
begin
  select count(*) into n from photobook_album_pages where album_id = a.id;
  if n <> a.page_count then raise exception 'Envoi incomplet : % pages sur %', n, a.page_count; end if;
  update photobook_albums set status = 'sent', sent_at = coalesce(sent_at, now()) where id = a.id;
  return json_build_object('ok', true, 'expires_at', a.expires_at);
end $$;

create or replace function public.photobook_owner_feedback(p_album uuid, p_owner text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_owned(p_album, p_owner);
begin
  return json_build_object(
    'album', json_build_object('id', a.id, 'title', a.title, 'client_name', a.client_name, 'client_email', a.client_email, 'status', a.status,
      'page_count', a.page_count, 'expires_at', a.expires_at, 'sent_at', a.sent_at, 'first_viewed_at', a.first_viewed_at,
      'last_viewed_at', a.last_viewed_at, 'view_count', a.view_count, 'decided_at', a.decided_at, 'client_note', a.client_note),
    'pages', coalesce((select json_agg(json_build_object('page_no', page_no, 'status', status) order by page_no) from photobook_album_pages where album_id = a.id), '[]'),
    'comments', coalesce((select json_agg(json_build_object('id', id, 'page_no', page_no, 'x', x, 'y', y, 'body', body, 'author', author,
      'from_client', from_client, 'resolved', resolved, 'created_at', created_at) order by created_at) from photobook_comments where album_id = a.id), '[]'));
end $$;

create or replace function public.photobook_owner_page(p_album uuid, p_owner text, p_page_no int) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_owned(p_album, p_owner); r photobook_album_pages;
begin
  select * into r from photobook_album_pages where album_id = a.id and page_no = p_page_no;
  return json_build_object('width', r.width, 'height', r.height, 'image', r.image);
end $$;

create or replace function public.photobook_owner_list(p_studio_key text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare s uuid := photobook_studio(p_studio_key);
begin
  return coalesce((select json_agg(json_build_object('id', a.id, 'title', a.title, 'client_name', a.client_name, 'status', a.status,
    'page_count', a.page_count, 'sent_at', a.sent_at, 'last_viewed_at', a.last_viewed_at, 'expires_at', a.expires_at,
    'comments', (select count(*) from photobook_comments c where c.album_id = a.id and c.from_client and not c.resolved)) order by a.created_at desc)
    from photobook_albums a where a.studio_id = s), '[]');
end $$;

create or replace function public.photobook_owner_comment(p_album uuid, p_owner text, p_page_no int, p_body text) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_owned(p_album, p_owner);
begin
  insert into photobook_comments (album_id, page_no, body, author, from_client) values (a.id, p_page_no, left(p_body, 2000), 'Photographe', false);
end $$;

create or replace function public.photobook_owner_resolve(p_album uuid, p_owner text, p_comment bigint, p_resolved boolean) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_owned(p_album, p_owner);
begin
  update photobook_comments set resolved = p_resolved where id = p_comment and album_id = a.id;
end $$;

create or replace function public.photobook_owner_extend(p_album uuid, p_owner text, p_days int) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_owned(p_album, p_owner);
begin
  update photobook_albums set expires_at = greatest(now(), expires_at) + make_interval(days => greatest(1, least(365, p_days))),
    status = case when status in ('validated', 'changes') then 'viewed' else status end where id = a.id;
end $$;

create or replace function public.photobook_owner_delete(p_album uuid, p_owner text) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_owned(p_album, p_owner);
begin
  delete from photobook_albums where id = a.id;
end $$;

-- ---------- client ----------
create or replace function public.photobook_client_open(p_token text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_client(p_token); st text;
begin
  st := case when a.status = 'sent' then 'viewed' else a.status end;
  update photobook_albums set status = st, view_count = view_count + 1, last_viewed_at = now(),
    first_viewed_at = coalesce(first_viewed_at, now()) where id = a.id;
  return json_build_object(
    'album', json_build_object('title', a.title, 'client_name', a.client_name, 'message', a.message, 'watermark', a.watermark,
      'allow_comments', a.allow_comments, 'page_count', a.page_count, 'status', st, 'expires_at', a.expires_at, 'client_note', a.client_note),
    'pages', coalesce((select json_agg(json_build_object('page_no', page_no, 'status', status, 'width', width, 'height', height) order by page_no)
      from photobook_album_pages where album_id = a.id), '[]'),
    'comments', coalesce((select json_agg(json_build_object('id', id, 'page_no', page_no, 'x', x, 'y', y, 'body', body, 'author', author,
      'from_client', from_client, 'created_at', created_at) order by created_at) from photobook_comments where album_id = a.id), '[]'));
end $$;

create or replace function public.photobook_client_page(p_token text, p_page_no int) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_client(p_token); r photobook_album_pages;
begin
  select * into r from photobook_album_pages where album_id = a.id and page_no = p_page_no;
  if r.album_id is null then raise exception 'Page introuvable'; end if;
  return json_build_object('width', r.width, 'height', r.height, 'image', r.image);
end $$;

create or replace function public.photobook_client_comment(p_token text, p_page_no int, p_x real, p_y real, p_body text, p_author text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_client(p_token); r photobook_comments;
begin
  if not a.allow_comments then raise exception 'Les remarques ne sont pas activées pour cet album'; end if;
  if a.status in ('validated', 'changes') then raise exception 'Votre réponse a déjà été envoyée'; end if;
  if p_page_no < 1 or p_page_no > a.page_count then raise exception 'Numéro de page invalide'; end if;
  if (select count(*) from photobook_comments where album_id = a.id) >= 500 then raise exception 'Trop de remarques sur cet album'; end if;
  insert into photobook_comments (album_id, page_no, x, y, body, author)
  values (a.id, p_page_no, p_x, p_y, left(trim(p_body), 2000), left(coalesce(p_author, a.client_name), 120)) returning * into r;
  return json_build_object('id', r.id, 'page_no', r.page_no, 'x', r.x, 'y', r.y, 'body', r.body, 'author', r.author, 'from_client', true, 'created_at', r.created_at);
end $$;

create or replace function public.photobook_client_uncomment(p_token text, p_comment bigint) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_client(p_token);
begin
  if a.status in ('validated', 'changes') then raise exception 'Votre réponse a déjà été envoyée'; end if;
  delete from photobook_comments where id = p_comment and album_id = a.id and from_client;
end $$;

create or replace function public.photobook_client_set_page(p_token text, p_page_no int, p_status text) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_client(p_token);
begin
  if a.status in ('validated', 'changes') then raise exception 'Votre réponse a déjà été envoyée'; end if;
  if p_status is not null and p_status not in ('ok', 'change') then raise exception 'Statut invalide'; end if;
  update photobook_album_pages set status = p_status where album_id = a.id and page_no = p_page_no;
end $$;

create or replace function public.photobook_client_decide(p_token text, p_decision text, p_note text) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a photobook_albums := photobook_client(p_token);
begin
  if a.status in ('validated', 'changes') then raise exception 'Votre réponse a déjà été envoyée'; end if;
  if p_decision not in ('validated', 'changes') then raise exception 'Décision invalide'; end if;
  update photobook_albums set status = p_decision, decided_at = now(), client_note = left(coalesce(p_note, ''), 4000) where id = a.id;
end $$;

-- ---------- droits : seules les fonctions publiques sont appelables ----------
revoke all on function public.photobook_studio(text), public.photobook_owned(uuid, text), public.photobook_client(text),
  public.photobook_hash(text), public.photobook_secret() from public, anon, authenticated;
grant execute on function
  public.photobook_create_album(text, text, text, text, text, text, boolean, int, int),
  public.photobook_put_page(uuid, text, int, int, int, text),
  public.photobook_publish(uuid, text),
  public.photobook_owner_feedback(uuid, text),
  public.photobook_owner_page(uuid, text, int),
  public.photobook_owner_list(text),
  public.photobook_owner_comment(uuid, text, int, text),
  public.photobook_owner_resolve(uuid, text, bigint, boolean),
  public.photobook_owner_extend(uuid, text, int),
  public.photobook_owner_delete(uuid, text),
  public.photobook_client_open(text),
  public.photobook_client_page(text, int),
  public.photobook_client_comment(text, int, real, real, text, text),
  public.photobook_client_uncomment(text, bigint),
  public.photobook_client_set_page(text, int, text),
  public.photobook_client_decide(text, text, text)
to anon, authenticated;
