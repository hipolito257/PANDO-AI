# Database migrations

Schema changes are SQL files in this folder, applied automatically on every
**production** deploy by `scripts/migrate.ts` (run by `npm run build` before
`next build`). Preview deploys and local builds never touch the database.

To change the schema:

1. Edit `src/lib/schema.ts`.
2. Add the next numbered file, e.g. `0007_deal_tasks.sql`, with the SQL that
   brings the database in line. Prefer idempotent statements
   (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
3. Push. The deploy applies pending files in one transaction and records them
   in the `_Migration` table. If any statement fails, nothing is applied and
   the deploy stops, so production keeps running the previous version.

Never edit a file that has already been applied; add a new one instead.

After migrating, the script checks that every table and column declared in
`schema.ts` exists and prints a warning in the build log for anything missing.

To apply migrations from your machine (e.g. to a dev database):
`MIGRATE=1 DATABASE_URL=postgres://... npx tsx scripts/migrate.ts`
