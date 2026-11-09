#!/bin/sh
# Production role initialiser (F9, FR-009). Replaces infra/postgres/init/01-roles.sql, whose passwords
# are for development. Runs once, on an empty data volume, as the bootstrap superuser. The passwords
# are read from the secret files and travel to psql in its environment, never in its arguments or in
# a file of the repository.
#   app_migrator  owns the schema and runs the migrations.
#   app_runtime   the only role of the API and the worker: no BYPASSRLS, cannot alter the schema.
#   temporal      owns the Temporal databases (temporal, temporal_visibility).
set -eu

secret() {
  [ -s "/run/secrets/$1" ] || { echo "missing secret file: $1" >&2; exit 1; }
  tr -d '\r\n' <"/run/secrets/$1"
}

APP_MIGRATOR_PASSWORD="$(secret app_migrator_password)" \
APP_RUNTIME_PASSWORD="$(secret app_runtime_password)" \
TEMPORAL_DB_PASSWORD="$(secret temporal_db_password)" \
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv migrator_password APP_MIGRATOR_PASSWORD
\getenv runtime_password APP_RUNTIME_PASSWORD
\getenv temporal_password TEMPORAL_DB_PASSWORD

CREATE ROLE app_migrator LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE app_runtime LOGIN PASSWORD :'runtime_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE temporal LOGIN PASSWORD :'temporal_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO app_migrator', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database());
END
$$;

ALTER SCHEMA public OWNER TO app_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_runtime;

CREATE DATABASE temporal OWNER temporal;
CREATE DATABASE temporal_visibility OWNER temporal;
REVOKE CONNECT ON DATABASE temporal FROM PUBLIC;
REVOKE CONNECT ON DATABASE temporal_visibility FROM PUBLIC;
SQL
