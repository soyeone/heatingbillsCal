-- =========================================================
-- 난방비 대시보드 Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- =========================================================

-- 1) 일별 계량기 검침값
create table if not exists public.meter_readings (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reading_date date not null,
  meter_value numeric(14, 3) not null check (meter_value >= 0),
  memo        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, reading_date)
);

create index if not exists meter_readings_user_date_idx
  on public.meter_readings (user_id, reading_date);

-- 2) 월별 단가 (1단위(L)당 요금)
create table if not exists public.monthly_rates (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month      text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),  -- 'YYYY-MM'
  unit_price numeric(12, 4) not null check (unit_price >= 0),
  base_fee   numeric(12, 0) not null default 0 check (base_fee >= 0),  -- 기본요금(선택)
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

-- 3) updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_meter_readings_touch on public.meter_readings;
create trigger trg_meter_readings_touch
  before update on public.meter_readings
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_monthly_rates_touch on public.monthly_rates;
create trigger trg_monthly_rates_touch
  before update on public.monthly_rates
  for each row execute function public.touch_updated_at();

-- 4) Row Level Security: 본인 데이터만 접근 가능
alter table public.meter_readings enable row level security;
alter table public.monthly_rates  enable row level security;

drop policy if exists "readings_select_own" on public.meter_readings;
drop policy if exists "readings_insert_own" on public.meter_readings;
drop policy if exists "readings_update_own" on public.meter_readings;
drop policy if exists "readings_delete_own" on public.meter_readings;

create policy "readings_select_own" on public.meter_readings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "readings_insert_own" on public.meter_readings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "readings_update_own" on public.meter_readings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "readings_delete_own" on public.meter_readings
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "rates_select_own" on public.monthly_rates;
drop policy if exists "rates_insert_own" on public.monthly_rates;
drop policy if exists "rates_update_own" on public.monthly_rates;
drop policy if exists "rates_delete_own" on public.monthly_rates;

create policy "rates_select_own" on public.monthly_rates
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "rates_insert_own" on public.monthly_rates
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "rates_update_own" on public.monthly_rates
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "rates_delete_own" on public.monthly_rates
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 익명(anon) 역할에는 어떤 권한도 주지 않습니다.
revoke all on public.meter_readings from anon;
revoke all on public.monthly_rates  from anon;
