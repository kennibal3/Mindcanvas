-- =============================================================
-- 024_room_scene_snapshots.sql
-- BUG-020 一期：画布删除前自动留档
--
-- 起因（2026-08-11 生产事故）：
--   房间 5f160f5d 的 675 个元素里，全部 286 个存活元素被一次操作标记 isDeleted。
--   数据之所以救得回来，纯粹是因为 throttledPersistSceneDB 的 30 秒节流
--   让 PostgreSQL 那份落后了 12 秒、恰好停在删除之前。
--   **一个从没设计过的副作用成了唯一的安全网——这是运气不是韧性。**
--   本表把那份运气变成机制。
--
-- 为什么要新表而不是给 room_scenes 加版本列：
--   room_scenes 是 ON CONFLICT (room_id) DO UPDATE 的**单行当前态**表，
--   version 列只是个自增计数，历史内容从来没被保留过。
--   要留历史就必须是多行，与「当前态」是两种不同的东西，混在一张表里
--   会让 loadSceneFromDB 的 `ORDER BY updated_at DESC LIMIT 1` 语义变得可疑。
--
-- 为什么 room_id 不加外键：
--   与 REQ-050 的 diagram_generations 同样的理由——这是旁路观测/取证数据，
--   不能因为主表的任何状态让写入失败进而拖累正常编辑。
--   代价是房间删除后快照会残留，由 pruneSnapshots 的份数上限兜底
--   （每房间最多 snapshotKeepPerRoom 份），不会无限增长。
--
-- 容量估算（开工前实测，不是拍脑袋）：
--   事故房间单份场景 636762 字节 ≈ 622KB，是目前已知最大的房间之一。
--   每房间保留 20 份 ≈ 12MB 上限，且只有「有人大批量删除」才会产生。
--   JSONB 有内建压缩（TOAST），实际占用低于此数。
--
-- 幂等可重跑。
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN

IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'room_scene_snapshots') THEN

    CREATE TABLE room_scene_snapshots (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        -- 故意不加外键，理由见文件头
        room_id       UUID        NOT NULL,
        -- 删除发生**之前**的完整场景。恢复时把这一份写回 Redis 即可，
        -- 步骤见 DEV_LOG_20260811.md 第四节。
        scene_data    JSONB       NOT NULL,
        data_size     INT         NOT NULL DEFAULT 0,
        -- 快照时刻的存活元素数。事故当天就是靠「DB 存活 286 / Redis 存活 0」
        -- 这一对数字定的性，所以它必须是一等列，不能只躺在 JSON 里等人去数。
        element_count INT         NOT NULL DEFAULT 0,
        -- 触发本次留档的删除数量（本次消息声明的数量，非最终生效数量）
        deleted_count INT         NOT NULL DEFAULT 0,
        -- 触发原因。一期只有 'bulk_delete'；留成变长字符串是为了
        -- REQ-060 将来加 'periodic'（定期快照）/'manual'（教师手动存档）。
        reason        VARCHAR(32) NOT NULL DEFAULT 'bulk_delete',
        -- 谁触发的。教师是登录 UUID，学生是 guest-xxx 或花名册稳定 id。
        -- 不加外键同上（学生 UUID 本就不在 users 表里）。
        trigger_uuid  TEXT        NOT NULL DEFAULT '',
        -- teacher / student。**单独存一列而不是靠 UUID 前缀猜**——
        -- BUG-017/BUG-018 两次都栽在「用 guest- 前缀推断身份」上。
        trigger_role  VARCHAR(16) NOT NULL DEFAULT '',
        created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    RAISE NOTICE 'TABLE room_scene_snapshots created';
ELSE
    RAISE NOTICE 'TABLE room_scene_snapshots already exists, skipping';
END IF;

END $$;

-- 按房间取最近 N 份：pruneSnapshots 的 DELETE 与 REQ-060 的历史列表都走这个索引
CREATE INDEX IF NOT EXISTS idx_rss_room_time
    ON room_scene_snapshots(room_id, created_at DESC);

-- 015 建表时踩过 owner 坑，这里同样兜底
GRANT ALL ON room_scene_snapshots TO mindcanvas;

SELECT 'Migration 024_room_scene_snapshots 执行完成' AS status;
