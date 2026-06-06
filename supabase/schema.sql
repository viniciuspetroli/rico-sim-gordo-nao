-- ═══════════════════════════════════════════════════════════════
-- Schema do painel rico sim, gordo não
-- Cole tudo isso no Supabase → SQL Editor → New query → Run
-- Pode rodar de novo sem medo (tudo é IF NOT EXISTS / idempotente)
-- ═══════════════════════════════════════════════════════════════

-- ─── PEDIDOS ───────────────────────────────────────────────────
create table if not exists public.orders (
  id                     uuid primary key default gen_random_uuid(),
  stripe_session_id      text unique not null,
  stripe_payment_intent  text,
  buyer_name             text,
  buyer_email            text,
  buyer_phone            text,
  buyer_cpf              text,
  color                  text,           -- verde | marrom
  product_name           text,
  amount_total           integer,        -- em centavos
  currency               text default 'brl',
  ship_line1             text,
  ship_line2             text,
  ship_city              text,
  ship_state             text,
  ship_postal_code       text,
  ship_country           text default 'BR',
  status                 text default 'paid',  -- paid | label_generated | label_failed | shipped | delivered | refunded
  me_order_id            text,
  tracking_code          text,
  label_url              text,
  shipping_service       text,
  shipping_price         numeric,
  error_message          text,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now(),
  shipped_at             timestamptz,
  delivered_at           timestamptz
);

create index if not exists orders_status_idx     on public.orders (status);
create index if not exists orders_created_at_idx  on public.orders (created_at desc);
create index if not exists orders_color_idx       on public.orders (color);

-- ─── WAITLIST ──────────────────────────────────────────────────
create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  email       text,
  color       text default 'verde',
  user_agent  text,
  ip          text,
  notified    boolean default false,
  created_at  timestamptz default now()
);

create unique index if not exists waitlist_email_color_idx on public.waitlist (email, color);

-- ─── LOG DE EVENTOS (técnico) ──────────────────────────────────
create table if not exists public.event_log (
  id                 uuid primary key default gen_random_uuid(),
  type               text,    -- checkout.session.completed | shipment_error | waitlist_signup | ...
  source             text,    -- stripe-webhook | admin-generate-etiqueta | waitlist | backfill
  stripe_session_id  text,
  status             text,    -- ok | error
  error              text,
  payload            jsonb,
  created_at         timestamptz default now()
);

create index if not exists event_log_created_at_idx on public.event_log (created_at desc);
create index if not exists event_log_type_idx        on public.event_log (type);

-- ─── REQUEST LOG (toda batida nos endpoints de integração) ─────
create table if not exists public.request_log (
  id          uuid primary key default gen_random_uuid(),
  source      text,      -- stripe-webhook | me-callback | waitlist | ...
  method      text,
  path        text,
  query       jsonb,
  headers     jsonb,
  body        text,
  ip          text,
  status      integer,
  response    text,
  created_at  timestamptz default now()
);
create index if not exists request_log_created_at_idx on public.request_log (created_at desc);
create index if not exists request_log_source_idx     on public.request_log (source);

-- ─── DROPS (controla disponibilidade no site) ─────────────────
create table if not exists public.drops (
  color               text primary key,   -- verde | marrom
  label               text,
  available           boolean default true,  -- chave mestra liga/desliga
  stock               integer,                -- quantidade; null = ilimitado
  stripe_payment_link text,
  sort                integer default 0,
  updated_at          timestamptz default now()
);
-- pra bancos que já existiam antes da coluna stock:
alter table public.drops add column if not exists stock integer;
-- flag pra não descontar estoque duas vezes no mesmo pedido (reenvio de webhook):
alter table public.orders add column if not exists stock_decremented boolean default false;
-- quantidade total de unidades no pedido:
alter table public.orders add column if not exists quantity integer default 1;
-- detalhamento por cor do pedido (order bump pode misturar cores): {"verde":1,"marrom":1}
alter table public.orders add column if not exists items jsonb;
-- flag pra não mandar o e-mail de confirmação duas vezes:
alter table public.orders add column if not exists confirmation_sent boolean default false;

-- Seed inicial: verde esgotado, marrom disponível
insert into public.drops (color, label, available, stripe_payment_link, sort) values
  ('verde',  'Verde militar', false, 'https://buy.stripe.com/3cIfZh25Va6I4Bk9AK7EQ00', 1),
  ('marrom', 'Marrom terra',  true,  'https://buy.stripe.com/fZuaEXaCr7YA7Nw7sC7EQ01', 2)
on conflict (color) do nothing;

-- Desconta o estoque por quantidade e por cor, no máximo uma vez por pedido.
-- p_items é um jsonb tipo {"verde": 3, "marrom": 1}.
drop function if exists public.register_sale(text, text);
create or replace function public.register_sale(p_session_id text, p_items jsonb)
returns void language plpgsql as $$
declare _color text; _qty int;
begin
  if exists (select 1 from public.orders where stripe_session_id = p_session_id and coalesce(stock_decremented, false) = false) then
    for _color, _qty in select key, value::int from jsonb_each_text(p_items) loop
      update public.drops set stock = greatest(coalesce(stock, 0) - _qty, 0)
        where color = _color and stock is not null;
    end loop;
    update public.orders set stock_decremented = true where stripe_session_id = p_session_id;
  end if;
end; $$;

-- ─── updated_at automático ─────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

drop trigger if exists drops_touch on public.drops;
create trigger drops_touch before update on public.drops
  for each row execute function public.touch_updated_at();

-- ─── SEGURANÇA (RLS) ───────────────────────────────────────────
-- Tudo trancado. As serverless functions usam a service_role key,
-- que ignora RLS. O público não lê nada direto pelo anon key.
alter table public.orders      enable row level security;
alter table public.waitlist    enable row level security;
alter table public.event_log   enable row level security;
alter table public.drops       enable row level security;
alter table public.request_log enable row level security;

-- (sem policies = ninguém com anon key acessa; service_role passa direto)
