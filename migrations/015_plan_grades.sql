-- Filled with the shared rowGrade rules by migrate.ts before this migration commits.
-- NULL allows compatibility with legacy writers; readers fall back to plans.grade.
ALTER TABLE plans ADD COLUMN grades integer[];
ALTER TABLE plans ADD CONSTRAINT plans_grades_check CHECK (
  grades IS NULL OR (
    grades <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11]::integer[]
    AND array_position(grades, NULL) IS NULL
  )
);
