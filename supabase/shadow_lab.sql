create table if not exists public.shadow_lab (
  id text primary key,
  metodo text not null,
  fixture_id bigint,
  liga text,
  casa text,
  fora text,
  minuto integer,
  placar text,
  gols integer,
  xg numeric,
  no_alvo integer,
  stake numeric,
  odd numeric,
  status text not null default 'aberta',
  lucro numeric,
  placar_final text,
  gol_intervalo boolean,
  placar_intervalo text,
  entrada jsonb not null,
  em timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table public.shadow_lab disable row level security;
