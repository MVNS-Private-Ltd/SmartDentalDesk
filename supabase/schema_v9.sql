-- schema_v9.sql
-- Simplifies patient uniqueness to ONLY phone and email.
-- Drops the name+dob and name-only unique indexes added in v8.

DROP INDEX IF EXISTS patients_name_dob_unique;
DROP INDEX IF EXISTS patients_name_only_unique;
