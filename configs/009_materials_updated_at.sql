-- =============================================================
-- MindCanvas V4.3 - 补充 assignment_materials.updated_at 字段
-- 原007_assignment.sql建表时遗漏了updated_at
-- 幂等执行：使用 IF NOT EXISTS / DO NOTHING 保护
-- =============================================================

-- 补充 updated_at 字段（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'assignment_materials'
          AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE assignment_materials
            ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();

        -- 将已有记录的 updated_at 初始化为 created_at
        UPDATE assignment_materials SET updated_at = created_at;

        RAISE NOTICE 'assignment_materials.updated_at 字段已添加';
    ELSE
        RAISE NOTICE 'assignment_materials.updated_at 已存在，跳过';
    END IF;
END $$;

-- 补充索引（加速 recoverStuckParsingTasks 查询）
CREATE INDEX IF NOT EXISTS idx_am_parse_updated
    ON assignment_materials(parse_status, updated_at)
    WHERE parse_status = 'parsing';

SELECT 'V4.3 migration 009 OK' AS result;
