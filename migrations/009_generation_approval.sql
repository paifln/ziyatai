-- Approval applies to one immutable revision, never to later edits or regenerations.
ALTER TABLE generation_versions ADD COLUMN reviewed_at timestamptz;
ALTER TABLE generation_versions ADD COLUMN reviewed_by text REFERENCES "user"(id);
-- Preserve acknowledgements explicitly recorded for an exported historical snapshot.
UPDATE generation_versions v SET reviewed_at = e.created_at, reviewed_by = e.owner_id
FROM (SELECT DISTINCT ON (generation_version_id) generation_version_id, owner_id, created_at
      FROM exports WHERE teacher_reviewed = true ORDER BY generation_version_id, created_at) e
WHERE v.id = e.generation_version_id;
