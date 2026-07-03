-- =============================================================
-- MindCanvas v4.1 - Excalidraw场景持久化 Migration
-- 解决问题：场景仅存Redis导致7天后丢失
-- 方案：双写 Redis（热缓存）+ PostgreSQL（永久备份）
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------
-- 1. room_scenes 表：Excalidraw完整场景持久化存储
--    每个房间只保留最新一条（UPSERT on conflict room_id）
--    同时保留历史快照（version递增）用于回滚
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_scenes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    -- scene_data: 完整的Excalidraw场景JSON
    -- 格式: {"elements": [...], "appState": {...}}
    scene_data  JSONB NOT NULL DEFAULT '{}',
    -- 场景数据大小（字节），用于监控
    data_size   INT NOT NULL DEFAULT 0,
    -- 版本号，每次保存递增，支持历史回滚
    version     INT NOT NULL DEFAULT 1,
    -- 最后保存者UUID（教师ID或学生UUID）
    saved_by    VARCHAR(100) NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE room_scenes IS 'Excalidraw场景持久化表：双写Redis+PG，解决Redis过期丢失问题';
COMMENT ON COLUMN room_scenes.scene_data IS '完整Excalidraw场景JSON，包含elements数组和appState';
COMMENT ON COLUMN room_scenes.version IS '场景版本号，每次scene_update递增，支持历史查看';
COMMENT ON COLUMN room_scenes.data_size IS '场景数据字节数，用于存储监控和告警';

-- 每个房间唯一索引（用于UPSERT当前场景）
CREATE UNIQUE INDEX IF NOT EXISTS idx_rs_room_unique
    ON room_scenes(room_id);

-- 按更新时间排序（查询最新场景）
CREATE INDEX IF NOT EXISTS idx_rs_updated
    ON room_scenes(updated_at DESC);

-- -------------------------------------------------------------
-- 2. 将现有Redis场景数据迁移到PostgreSQL
--    通过应用层在下次scene_update时自动双写
--    此处仅为已有房间创建空记录占位（避免首次查询慢）
-- -------------------------------------------------------------
INSERT INTO room_scenes (room_id, scene_data, data_size, version, saved_by)
SELECT
    id,
    '{}'::JSONB,
    0,
    0,
    'system_migration'
FROM rooms
WHERE status IN ('active', 'finished')
ON CONFLICT (room_id) DO NOTHING;

SELECT 'Migration 004_scene_persistence 执行完成' AS status;
