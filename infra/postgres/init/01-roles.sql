-- Runs once, on an empty data volume (docker-entrypoint-initdb.d), as the bootstrap superuser.
-- Passwords are for local development only (research R9); other environments set their own.
--
-- app_migrator: owns the schema and the tables, runs migrations, never used by the API.
-- app_runtime: the only role the API connects as. It cannot bypass row-level security,
-- alter the schema or delete rows.
CREATE ROLE app_migrator LOGIN PASSWORD 'app_migrator_dev_only'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime_dev_only'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

DO $$
BEGIN
  -- drizzle-kit keeps its migration journal in its own schema, created by the migrator.
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO app_migrator', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
END
$$;

ALTER SCHEMA public OWNER TO app_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_runtime;
