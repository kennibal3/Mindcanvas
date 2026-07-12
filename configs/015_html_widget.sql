-- 015_html_widget.sql
-- REQ-041 一期：HTML 展示组件
-- html_widget_contents 表：存 html_widget 元素的 HTML 源码。
--   源码不进 room_elements.payload（REQ-032 教训：base64 进 payload 撑爆 2MB 场景容量），
--   元素本体仍是一条 room_elements（type=html_widget，payload 仅 {title}），
--   源码单独落此表按 element_id 引用，广播只传 element_id，客户端各自 GET 拉取。
-- 幂等，可重复执行。
-- 注意：迁移编号 012 有历史冲突（012_chat / 012_groups_v2），本表从 015 起编。

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN

-- ── 1. 创建 html_widget_contents 表 ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'html_widget_contents') THEN

    CREATE TABLE html_widget_contents (
        element_id  UUID        PRIMARY KEY REFERENCES room_elements(id) ON DELETE CASCADE,
        room_id     UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        html        TEXT        NOT NULL DEFAULT '',   -- HTML 源码（含内联 CSS/JS）
        byte_size   INTEGER     NOT NULL DEFAULT 0,    -- 源码字节数，应用层上限 512KB
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    COMMENT ON TABLE  html_widget_contents IS 'HTML 展示组件源码表（REQ-041），按 element_id 引用，源码不进场景 payload';
    COMMENT ON COLUMN html_widget_contents.html      IS '老师粘贴的 HTML 源码，前端在 iframe sandbox=allow-scripts 中渲染';
    COMMENT ON COLUMN html_widget_contents.byte_size IS '源码字节数，应用层上限 512KB（防超大代码拖垮渲染/传输）';

    RAISE NOTICE 'TABLE html_widget_contents created';
ELSE
    RAISE NOTICE 'TABLE html_widget_contents already exists, skipping';
END IF;

-- ── 2. 索引 ──────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hwc_room') THEN
    CREATE INDEX idx_hwc_room ON html_widget_contents(room_id);
    RAISE NOTICE 'INDEX idx_hwc_room created';
END IF;

END $$;

-- room_elements 类型常量注释补记 html_widget
COMMENT ON TABLE room_elements IS '画布元素表：text_card/image_card/video_card/file_card/polling_widget/wordcloud_widget/qa_widget/dropzone_widget/shelf_widget/html_widget/excalidraw_stroke';

SELECT 'Migration 015_html_widget 执行完成' AS status;
