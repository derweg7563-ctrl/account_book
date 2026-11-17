alter table public.expense
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

alter table public.expense
  alter column user_id set default auth.uid();

create index if not exists expense_user_id_idx on public.expense (user_id);

alter table public.expense enable row level security;

revoke all on table public.expense from anon;
grant select, insert, update, delete on table public.expense to authenticated;

create or replace function public.set_expense_user_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
  else
    new.user_id := old.user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.set_expense_user_id() from public, anon, authenticated;

drop trigger if exists expense_set_user_id on public.expense;
create trigger expense_set_user_id
before insert or update on public.expense
for each row
execute function public.set_expense_user_id();

drop policy if exists expense_select_own on public.expense;
create policy expense_select_own
on public.expense
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists expense_insert_own on public.expense;
create policy expense_insert_own
on public.expense
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists expense_update_own on public.expense;
create policy expense_update_own
on public.expense
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists expense_delete_own on public.expense;
create policy expense_delete_own
on public.expense
for delete
to authenticated
using (auth.uid() = user_id);
