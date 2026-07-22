-- =============================================================
-- MindCanvas 迁移 018 - 房间协作形态 collab_mode（REQ-046 P1 团队模式）
-- 说明：新开一维「身份/权限」形态，与既有 room_mode（画布形态：
--       whiteboard/cards/interactive）正交，切勿混用。
--   roster    实名上课：花名册真名入场，删除仅限自己（REQ-045 P2 启用）
--   anonymous 匿名培训：自由昵称（现状），删除仅限自己（默认值）
--   team      团队协作：人人可删他人元素
-- 默认 anonymous＝完全保持现状，存量房间零影响、零回填。
-- 幂等：列不存在才加。
-- =============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rooms' AND column_name = 'collab_mode'
    ) THEN
        ALTER TABLE rooms ADD COLUMN collab_mode VARCHAR(20) NOT NULL DEFAULT 'anonymous'
            CHECK (collab_mode IN ('roster', 'anonymous', 'team'));
        COMMENT ON COLUMN rooms.collab_mode IS
            '房间协作形态：roster=实名上课 / anonymous=匿名培训(默认) / team=团队协作(人人可删)';
    END IF;
END $$;
