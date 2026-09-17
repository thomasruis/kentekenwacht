-- Kentekenwacht — Cloudflare D1 (SQLite)
-- Aanmaken:  npx wrangler d1 execute kentekenwacht --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS abonnees (
  id                     TEXT PRIMARY KEY,
  email                  TEXT NOT NULL,
  plan                   TEXT NOT NULL DEFAULT 'particulier',  -- particulier | zakelijk
  status                 TEXT NOT NULL DEFAULT 'actief',       -- actief | opgezegd | betaling_mislukt
  max_kentekens          INTEGER NOT NULL DEFAULT 3,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  beheer_token           TEXT NOT NULL,
  aangemaakt_op          TEXT NOT NULL,
  bijgewerkt_op          TEXT NOT NULL,
  periode_eindigt_op     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_abonnees_email ON abonnees(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_abonnees_token ON abonnees(beheer_token);
CREATE INDEX IF NOT EXISTS idx_abonnees_sub ON abonnees(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS kentekens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  abonnee_id     TEXT NOT NULL REFERENCES abonnees(id) ON DELETE CASCADE,
  kenteken       TEXT NOT NULL,
  label          TEXT,
  toegevoegd_op  TEXT NOT NULL,
  laatste_check  TEXT,
  -- Momentopname van de vorige controle; hiermee detecteren we wijzigingen.
  snapshot       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kenteken_uniek ON kentekens(abonnee_id, kenteken);
CREATE INDEX IF NOT EXISTS idx_kenteken_abonnee ON kentekens(abonnee_id);

-- Voorkomt dat dezelfde waarschuwing twee keer wordt verstuurd.
CREATE TABLE IF NOT EXISTS meldingen (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  abonnee_id  TEXT NOT NULL,
  kenteken    TEXT NOT NULL,
  soort       TEXT NOT NULL,   -- apk_60 | apk_30 | apk_7 | apk_verlopen | recall | wam | teller | gebreken | tenaamstelling
  sleutel     TEXT NOT NULL,   -- unieke sleutel binnen de soort, bv. de recall-referentie
  verzonden_op TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_melding_uniek
  ON meldingen(abonnee_id, kenteken, soort, sleutel);

-- Logregel per uitgevoerde job, zodat de wekelijkse rapportage iets te lezen heeft.
CREATE TABLE IF NOT EXISTS job_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job          TEXT NOT NULL,
  gestart_op   TEXT NOT NULL,
  duur_ms      INTEGER,
  gecontroleerd INTEGER DEFAULT 0,
  verzonden    INTEGER DEFAULT 0,
  fouten       INTEGER DEFAULT 0,
  detail       TEXT
);
