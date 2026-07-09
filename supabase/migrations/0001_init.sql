-- HyroxAI v1 schema (architecture-plan.md §4)

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  first_name text not null,
  age int not null,
  body_weight numeric not null,
  weight_unit text not null check (weight_unit in ('lbs', 'kg')),
  running_exp text not null check (running_exp in ('beginner', 'intermediate', 'advanced')),
  hybrid_exp text not null check (hybrid_exp in ('beginner', 'intermediate', 'advanced')),
  lifting_exp text not null check (lifting_exp in ('beginner', 'intermediate', 'advanced')),
  training_class text not null check (training_class in ('non_highly_trained', 'highly_trained')),
  training_days text[] not null,
  benchmarks jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  program_type text not null check (program_type in ('goal_event', 'fixed_duration', 'general_fitness')),
  duration_weeks int not null check (duration_weeks between 4 and 24),
  start_date date not null,
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  skeleton jsonb,
  program_data jsonb,
  input_snapshot jsonb not null,
  philosophy_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists races (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  race_date date not null,
  priority text not null check (priority in ('A', 'B', 'C'))
);

alter table profiles enable row level security;
alter table programs enable row level security;
alter table races enable row level security;

create policy "profiles: own row" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "programs: own rows" on programs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "races: own via program" on races
  for all using (
    exists (select 1 from programs p where p.id = races.program_id and p.user_id = auth.uid())
  )
  with check (
    exists (select 1 from programs p where p.id = races.program_id and p.user_id = auth.uid())
  );
