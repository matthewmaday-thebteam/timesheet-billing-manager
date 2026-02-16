-- Refresh v_employee_table_entities to pick up bamboo_employee_id column
-- The view was created in migration 015 with r.* but PostgreSQL resolves
-- column lists at view creation time, so columns added later are not included.
-- DROP + CREATE required because column order changed (CREATE OR REPLACE fails).

DROP VIEW IF EXISTS v_employee_table_entities;

CREATE VIEW v_employee_table_entities AS
SELECT
    r.*,
    -- Include employment type for convenience
    et.name AS employment_type_name,
    -- Include canonical info for display
    vec.role AS grouping_role,
    vec.group_id,
    -- Include count of members (if primary)
    COALESCE(
        (
            SELECT COUNT(*)::INTEGER
            FROM physical_person_group_members m
            WHERE m.group_id = vec.group_id
        ),
        0
    ) AS member_count
FROM resources r
LEFT JOIN employment_types et ON et.id = r.employment_type_id
LEFT JOIN v_entity_canonical vec ON vec.entity_id = r.id
WHERE vec.role IS NULL OR vec.role != 'member';
