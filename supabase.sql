-- Kör detta en gång i Supabase: SQL Editor -> New query -> klistra in -> Run.
-- Skapar en tabell med en rad per användare och spärrar allt utom ditt eget konto.

create table if not exists public.budget_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.budget_state enable row level security;

drop policy if exists "Läs egen budget" on public.budget_state;
drop policy if exists "Skapa egen budget" on public.budget_state;
drop policy if exists "Ändra egen budget" on public.budget_state;

create policy "Läs egen budget" on public.budget_state
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Skapa egen budget" on public.budget_state
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Ändra egen budget" on public.budget_state
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
