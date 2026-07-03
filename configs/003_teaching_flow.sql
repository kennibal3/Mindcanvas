-- =============================================================
-- MindCanvas v4.1 - Phase 5 课堂流程控制器 Migration
-- 执行前请确保 001_init.sql 和 002_dropzone.sql 已执行
-- 包含：teaching_flows表、流程节点JSONB结构、相关索引
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------
-- 1. teaching_flows 课堂流程表
--    一个房间同一时间只有一个当前流程（active/draft）
--    历史流程通过 status=finished 保留
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teaching_flows (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id             UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    title               TEXT NOT NULL DEFAULT '课堂流程',
    -- nodes: JSONB数组，每个节点结构见下方注释
    -- [{
    --   id: string,              节点唯一ID(前端生成uuid)
    --   type: string,            类型: lecture/discussion/interaction/break/review
    --   title: string,           节点标题
    --   duration: int,           预计时长(分钟)
    --   notes: string,           教师备注(不对学生展示)
    --   widgetElementId: string, 绑定的Widget元素ID(interaction类型才有)
    --   autoOpenWidget: bool,    进入节点时提示开启Widget
    --   showToStudents: bool,    是否对学生展示此节点标题
    --   entryMode: string,       进入时画布模式: readonly/follow/free
    -- }]
    nodes               JSONB NOT NULL DEFAULT '[]',
    current_node_index  INT NOT NULL DEFAULT 0,       -- 当前执行到第几个节点(0开始)
    status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'active', 'finished')),
    -- 学生端进度条开关：教师全局控制，覆盖节点级showToStudents
    show_progress_to_students BOOLEAN NOT NULL DEFAULT FALSE,
    started_at          TIMESTAMPTZ,                  -- 开始上课时间
    finished_at         TIMESTAMPTZ,                  -- 结课时间
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE teaching_flows IS '课堂流程表：教师预设的节点序列，支持课中推进';
COMMENT ON COLUMN teaching_flows.nodes IS 'JSONB节点数组：每个节点含type/title/duration/widgetElementId等';
COMMENT ON COLUMN teaching_flows.current_node_index IS '当前节点索引，从0开始，-1表示未开始';
COMMENT ON COLUMN teaching_flows.status IS 'draft:草稿(课前编辑) / active:进行中 / finished:已结束';
COMMENT ON COLUMN teaching_flows.show_progress_to_students IS '是否向学生展示课堂进度条';

-- teaching_flows 索引
CREATE INDEX IF NOT EXISTS idx_tf_room       ON teaching_flows(room_id);
CREATE INDEX IF NOT EXISTS idx_tf_status     ON teaching_flows(status);
CREATE INDEX IF NOT EXISTS idx_tf_room_status ON teaching_flows(room_id, status);

-- -------------------------------------------------------------
-- 2. 为 rooms 表补充 room_mode 字段（若不存在）
--    Phase 5 执行时可能已有，做幂等处理
-- -------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rooms' AND column_name = 'room_mode'
    ) THEN
        ALTER TABLE rooms ADD COLUMN room_mode VARCHAR(20) DEFAULT 'whiteboard'
            CHECK (room_mode IN ('whiteboard', 'cards', 'interactive'));
        COMMENT ON COLUMN rooms.room_mode IS '房间模式：whiteboard/cards/interactive';
    END IF;
END $$;

SELECT 'Migration 003_teaching_flow 执行完成' AS status;
