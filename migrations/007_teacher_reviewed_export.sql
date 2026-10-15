-- A teacher's explicit acknowledgement belongs to the exact exported snapshot.
ALTER TABLE exports ADD COLUMN teacher_reviewed boolean NOT NULL DEFAULT false;
