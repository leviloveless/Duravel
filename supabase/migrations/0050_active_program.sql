-- The athlete's chosen active program (2026-09-28).
--
-- The dashboard used to guess which program to show ("the newest ready program
-- whose dates cover today") and gave no clear sign of which one it had picked.
-- Now the athlete picks. The plan-shaped cards follow this program; the history
-- (fitness, form, load ratio) is built from every program's logs regardless.
--
-- `on delete set null`: deleting the active program simply returns the athlete
-- to the automatic choice. The column is written by the athlete's own session
-- under the existing "profiles: own row" policy — no new policy is needed. The
-- server action checks the program is theirs and ready before saving it; RLS on
-- `programs` means a stray id could only ever point at a row they cannot read.

alter table public.profiles
  add column if not exists active_program_id uuid
  references public.programs (id) on delete set null;
