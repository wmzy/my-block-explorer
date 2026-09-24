-- Drop the vestigial search_history table: its recording API was removed
-- long ago and no code reads or writes the table. No data migration —
-- nothing consumed the rows.
DROP TABLE "search_history" CASCADE;
