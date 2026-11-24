-- What each Mimic run cost, in credits (see src/lib/mimic-credits.ts). The limit is now a credit balance per
-- 5-hour session instead of a number of runs. Older rows have no value and count as an average run.
alter table mimic_runs add column if not exists credits integer;
