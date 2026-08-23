-- Profile fields + soft-delete. Username is backfilled from the email local-part.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_key" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

UPDATE "users" u
SET "username" = n.username
FROM (
  SELECT
    id,
    CASE
      WHEN n = 1 THEN base
      ELSE left(base, 24) || n::text
    END AS username
  FROM (
    SELECT
      id,
      base,
      row_number() OVER (PARTITION BY base ORDER BY id) AS n
    FROM (
      SELECT
        id,
        CASE
          WHEN regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g') ~ '^[a-z][a-z0-9._-]*$'
            THEN regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g')
          ELSE 'user' || substr(replace(id, 'usr_', ''), 1, 8)
        END AS base
      FROM "users"
      WHERE "username" IS NULL OR btrim("username") = ''
    ) cleaned
  ) numbered
) n
WHERE u.id = n.id
  AND (u.username IS NULL OR btrim(u.username) = '');

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_uq" ON "users" ("username");
CREATE INDEX IF NOT EXISTS "users_active_idx" ON "users" ("is_active");

INSERT INTO "system_settings" ("key", "value", "updated_at")
VALUES
  ('org.shortName', '{"value":"Bhawarnath"}'::jsonb, now()),
  ('policy.cashCapPaise', '{"value":"2500000"}'::jsonb, now())
ON CONFLICT ("key") DO NOTHING;
