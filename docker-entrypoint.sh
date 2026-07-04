#!/bin/sh
set -e

# Apply pending migrations before the API starts.
echo "Running database migrations…"
npx prisma migrate deploy

# SEED_ON_START=true  → seed only when the DB is empty (safe across restarts;
#                       the seed script wipes all rows before inserting).
# SEED_ON_START=always → force a re-seed on every boot (demo/dev reset).
if [ "$SEED_ON_START" = "always" ]; then
  echo "Seeding database (forced)…"
  npx prisma db seed || echo "Seed skipped/failed (continuing)."
elif [ "$SEED_ON_START" = "true" ]; then
  ROWS=$(node -e "
    const { Client } = require('pg');
    (async () => {
      const c = new Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      const r = await c.query('SELECT COUNT(*)::int AS n FROM organisations');
      console.log(r.rows[0].n);
      await c.end();
    })().catch(() => console.log('error'));
  ")
  if [ "$ROWS" = "0" ]; then
    echo "Database empty — seeding…"
    npx prisma db seed || echo "Seed skipped/failed (continuing)."
  else
    echo "Database already has data ($ROWS organisations) — skipping seed."
  fi
fi

echo "Starting API…"
exec node dist/src/index.js
