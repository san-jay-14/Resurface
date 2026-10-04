-- Better Auth core tables (identity, sessions, linked provider accounts, verification tokens).
-- Shape mirrors better-auth's schema for a Postgres database using UUID ids
-- (advanced.database.generateId = "uuid"); verified against getAuthTables().

create table "user" (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text not null unique,
  "emailVerified" boolean not null default false,
  image           text,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);

create table session (
  id            uuid primary key default gen_random_uuid(),
  "expiresAt"   timestamptz not null,
  token         text not null unique,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now(),
  "ipAddress"   text,
  "userAgent"   text,
  "userId"      uuid not null references "user" (id) on delete cascade
);
create index session_user_idx on session ("userId");

create table account (
  id                       uuid primary key default gen_random_uuid(),
  "accountId"              text not null,
  "providerId"             text not null,
  "userId"                 uuid not null references "user" (id) on delete cascade,
  "accessToken"            text,
  "refreshToken"           text,
  "idToken"                text,
  "accessTokenExpiresAt"   timestamptz,
  "refreshTokenExpiresAt"  timestamptz,
  scope                    text,
  password                 text,
  "createdAt"              timestamptz not null default now(),
  "updatedAt"              timestamptz not null default now()
);
create index account_user_idx on account ("userId");
create unique index account_provider_idx on account ("providerId", "accountId");

create table verification (
  id            uuid primary key default gen_random_uuid(),
  identifier    text not null,
  value         text not null,
  "expiresAt"   timestamptz not null,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);
create index verification_identifier_idx on verification (identifier);
