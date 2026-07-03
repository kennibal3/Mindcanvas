-- Migration 013: 协作墙卡片表
-- 幂等写法，可重复执行

DO $$
BEGIN

  -- shelf_cards 主表
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'shelf_cards'
  ) THEN
    CREATE TABLE shelf_cards (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id      UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      element_id   UUID        NOT NULL REFERENCES room_elements(id) ON DELETE CASCADE,
      group_id     UUID        REFERENCES room_groups(id) ON DELETE SET NULL,
      author_uuid  TEXT        NOT NULL DEFAULT '',
      author_name  TEXT        NOT NULL DEFAULT '',
      card_type    TEXT        NOT NULL CHECK (card_type IN ('text', 'image', 'link')),
      content      TEXT        NOT NULL DEFAULT '',
      image_url    TEXT,
      link_url     TEXT,
      link_title   TEXT,
      sort_order   INT         NOT NULL DEFAULT 0,
      is_hidden    BOOLEAN     NOT NULL DEFAULT false,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    COMMENT ON TABLE  shelf_cards             IS '协作墙卡片';
    COMMENT ON COLUMN shelf_cards.element_id  IS '所属 ShelfWidget 元素 ID';
    COMMENT ON COLUMN shelf_cards.group_id    IS '所属分组，NULL 表示未分组';
    COMMENT ON COLUMN shelf_cards.card_type   IS 'text | image | link';
    COMMENT ON COLUMN shelf_cards.is_hidden   IS '教师隐藏（不删除）';
  END IF;

  -- 索引
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sc_element') THEN
    CREATE INDEX idx_sc_element ON shelf_cards(element_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sc_group') THEN
    CREATE INDEX idx_sc_group ON shelf_cards(group_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sc_room_created') THEN
    CREATE INDEX idx_sc_room_created ON shelf_cards(room_id, created_at DESC);
  END IF;

END $$;
