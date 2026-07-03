-- =============================================================
-- MindCanvas v4.1 - Phase 3B-1 作品墙基础设施 Migration
-- 执行前请确保 001_init.sql 已执行
-- 包含：room_files表、room_groups表、deadline字段、相关索引
-- =============================================================

-- 启用必要扩展（已有则跳过）
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------
-- 1. room_files 表：存储学生上传的文件元数据
--    文件实体存储在 /opt/mindcanvas/uploads/files/ 目录
--    action_data 中存储文件URL引用，此表存完整元数据
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_files (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id       UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    element_id    UUID REFERENCES room_elements(id) ON DELETE SET NULL,
    uploader_uuid VARCHAR(100) NOT NULL,  -- 学生UUID或教师user_id
    uploader_name VARCHAR(100) DEFAULT '',
    original_name VARCHAR(500) NOT NULL,  -- 原始文件名（含扩展名）
    storage_name  VARCHAR(500) NOT NULL,  -- 存储文件名（UUID+扩展名，防冲突）
    storage_path  TEXT NOT NULL,          -- 磁盘绝对路径
    url           TEXT NOT NULL,          -- 访问URL（/uploads/files/xxx）
    mime_type     VARCHAR(200) NOT NULL,
    file_size     BIGINT NOT NULL,        -- 字节数
    file_category VARCHAR(50) DEFAULT 'other',
    -- file_category 枚举：image/document/spreadsheet/presentation/archive/markdown/audio/code/other
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE room_files IS '作品墙文件上传元数据表，文件实体存储在本地磁盘或OSS';
COMMENT ON COLUMN room_files.storage_name IS '磁盘存储文件名，格式：{uuid}.{ext}，防止原始文件名冲突';
COMMENT ON COLUMN room_files.file_category IS '文件分类：image/document/spreadsheet/presentation/archive/markdown/audio/code/other';

-- room_files 索引
CREATE INDEX IF NOT EXISTS idx_rf_room       ON room_files(room_id);
CREATE INDEX IF NOT EXISTS idx_rf_element    ON room_files(element_id);
CREATE INDEX IF NOT EXISTS idx_rf_uploader   ON room_files(uploader_uuid);
CREATE INDEX IF NOT EXISTS idx_rf_category   ON room_files(file_category);
CREATE INDEX IF NOT EXISTS idx_rf_created    ON room_files(created_at DESC);

-- -------------------------------------------------------------
-- 2. room_groups 表：学生分组信息
--    支持 DropZone 分组提交和课堂分组协作
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,                    -- 小组名称，如"第一组"
    color           TEXT DEFAULT '#4472C4',           -- 小组颜色（用于UI区分）
    members         TEXT[] DEFAULT '{}',              -- 成员 guest_uuid 数组
    zone_element_id UUID REFERENCES room_elements(id) ON DELETE SET NULL,
    -- zone_element_id：画布上对应的 GroupZone 元素（可选）
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE room_groups IS '课堂分组表，支持作品墙分组提交和画布分组区域';
COMMENT ON COLUMN room_groups.members IS '成员guest_uuid数组，PostgreSQL原生数组类型';
COMMENT ON COLUMN room_groups.zone_element_id IS '画布上对应GroupZone元素ID，可为空';

-- room_groups 索引
CREATE INDEX IF NOT EXISTS idx_rg_room    ON room_groups(room_id);
CREATE INDEX IF NOT EXISTS idx_rg_name    ON room_groups(room_id, name);

-- -------------------------------------------------------------
-- 3. 扩展 widget_interactions 表
--    新增 updated_at 字段（若不存在）
--    注意：action_type=submit 时允许同一学生多次提交（不加唯一约束）
--    通过 maxPerStudent 应用层控制上限
-- -------------------------------------------------------------

-- 检查并添加 updated_at 字段（幂等操作）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'widget_interactions' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE widget_interactions ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
        COMMENT ON COLUMN widget_interactions.updated_at IS '操作更新时间，教师操作(like/pin/tag/hide)时更新';
    END IF;
END $$;

-- 检查并添加 group_id 字段（幂等操作）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'widget_interactions' AND column_name = 'group_id'
    ) THEN
        ALTER TABLE widget_interactions ADD COLUMN group_id UUID;
        COMMENT ON COLUMN widget_interactions.group_id IS '提交时所在小组ID，用于分组统计';
    END IF;
END $$;

-- 检查并添加 widget_type 字段（幂等操作）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'widget_interactions' AND column_name = 'widget_type'
    ) THEN
        ALTER TABLE widget_interactions ADD COLUMN widget_type VARCHAR(50) DEFAULT '';
        COMMENT ON COLUMN widget_interactions.widget_type IS '组件类型标记：polling_widget/wordcloud_widget/qa_widget/dropzone_widget';
    END IF;
END $$;

-- widget_interactions 补充索引（幂等）
CREATE INDEX IF NOT EXISTS idx_wi_widget_action ON widget_interactions(widget_type, action_type);
CREATE INDEX IF NOT EXISTS idx_wi_group         ON widget_interactions(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wi_created       ON widget_interactions(created_at DESC);

-- -------------------------------------------------------------
-- 4. 问答组件唯一约束（幂等）
--    防止同一学生对同一问答题重复提交答案
-- -------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'idx_wi_no_duplicate_answer'
    ) THEN
        CREATE UNIQUE INDEX idx_wi_no_duplicate_answer
        ON widget_interactions(element_id, student_uuid, action_type)
        WHERE action_type = 'answer';
    END IF;
END $$;

-- -------------------------------------------------------------
-- 5. 更新 room_elements 类型常量注释
--    确保 dropzone_widget 类型被正式记录
-- -------------------------------------------------------------
COMMENT ON TABLE room_elements IS '画布元素表：text_card/image_card/video_card/file_card/polling_widget/wordcloud_widget/qa_widget/dropzone_widget/excalidraw_stroke';

-- -------------------------------------------------------------
-- 6. 创建文件存储目录（SQL层记录，实际目录由部署脚本创建）
-- -------------------------------------------------------------
-- 目录：/opt/mindcanvas/uploads/files/
-- 目录：/opt/mindcanvas/uploads/files/images/（图片子目录）
-- 目录：/opt/mindcanvas/uploads/files/documents/（文档子目录）
-- 目录：/opt/mindcanvas/uploads/files/archives/（压缩包子目录）
-- 注意：目录创建由下方 shell 命令完成，此处仅作说明

SELECT 'Migration 002_dropzone 执行完成' AS status;
