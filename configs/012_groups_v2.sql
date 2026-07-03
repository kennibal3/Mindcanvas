DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'room_groups' AND column_name = 'leader_uuid'
    ) THEN
        ALTER TABLE room_groups ADD COLUMN leader_uuid TEXT NOT NULL DEFAULT '';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'room_groups' AND column_name = 'sort_order'
    ) THEN
        ALTER TABLE room_groups ADD COLUMN sort_order INT NOT NULL DEFAULT 0;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rg_sort ON room_groups(room_id, sort_order, created_at);

SELECT '012_groups_v2 执行完成' AS status;
