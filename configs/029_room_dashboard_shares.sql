-- =============================================================
-- 029_room_dashboard_shares.sql
-- REQ-066 一期：看板分享——给领导一个永久、免登录、免密码的链接，
-- 打开即看到房间里指定 HTML 看板组件（如画布 MCP 生成的「项目驾驶舱」）的最新版本。
--
-- 为什么不复用 room_shares：现有「发布分享」（课堂统计/作品墙）在 PublishShare 里
-- 按 room_id 只取一行、一个房间只允许一条记录；把看板链接塞进同一张表会让它读错行。
-- 两种分享并存（2026-10-14 用户拍板），各用各的表、各走各的地址（/share/ 与 /board/）。
--
-- 一个房间一条（room_id UNIQUE）：换看板组件时只改 element_id，链接 token 不变，
-- 已经发给领导的链接继续有效。element_id 置空（组件被硬删）时公开页提示看板已不存在。
-- 默认永久有效，不设过期与密码（用户拍板）；要作废就删记录。
-- =============================================================

CREATE TABLE IF NOT EXISTS room_dashboard_shares (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     UUID        NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
    element_id  UUID        REFERENCES room_elements(id) ON DELETE SET NULL,
    share_token TEXT        NOT NULL UNIQUE,
    view_count  INT         NOT NULL DEFAULT 0,
    created_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  room_dashboard_shares             IS 'REQ-066 看板分享：每房间一个免登录永久链接，展示指定 HTML 看板组件的最新内容';
COMMENT ON COLUMN room_dashboard_shares.element_id  IS '展示哪个 HTML 组件（html_widget_contents.element_id）；换组件不换 token';
COMMENT ON COLUMN room_dashboard_shares.share_token IS '公开地址 /board/:token 的随机 token';
