// Load .env explicitly rather than relying on drizzle-kit's own loading, so
// `npm run db:migrate` works from a plain double-clicked terminal on any machine.
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/maturityflow',
  },
  strict: true,
  verbose: true,
});
