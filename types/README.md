# types/

`database.types.ts` is **generated** from the Supabase schema — never hand-edit it.

## Regenerate after every migration
    npm run gen:types
Then commit the regenerated `database.types.ts` in the same commit as the migration.

## One-time setup (per machine)
    npx supabase login
    npx supabase link --project-ref <your-project-ref>

`gen:types` runs `supabase gen types typescript --linked --schema public` and writes
`types/database.types.ts`. Full plan: docs/future-phases/10-typed-supabase.md.
