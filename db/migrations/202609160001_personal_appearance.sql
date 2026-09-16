-- migrate:up
create table team.identity_appearance (
  identity_id uuid primary key references team.identities(id) on delete cascade,
  palette text not null check (palette in ('nature','neutral','tokyo-night')),
  mode text not null check (mode in ('system','light','dark')),
  revision integer not null default 1 check (revision > 0)
);

-- migrate:down
drop table team.identity_appearance;
