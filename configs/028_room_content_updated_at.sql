-- =============================================================
-- 028_room_content_updated_at.sql
-- REQ-065：房间「最近修改时间」
--
-- 为什么不能用现成的两个时间：
--   · rooms.updated_at 只在改房间名/容量/有效期时才动，画画不会碰它。
--   · room_scenes.updated_at 是「最近一次落库」的时间。BUG-021 加的
--     onRoomEmpty 会在最后一个人离开房间时无条件补写一次，所以它实际记的是
--     「最近有人进出过」——2026-10-14 生产实测：郯城房间显示 10-14 10:57，
--     真实最后一次改动是 10-09 15:38。
--
-- 新列 content_updated_at = 画布里元素自带的修改时间戳（Excalidraw 元素的
-- `updated` 字段，毫秒）的最大值。只要内容没变，重复落库它就不会变；
-- 删除元素也会刷新该元素的 updated，所以删除算修改。
-- 写入逻辑在 ws_handler.go persistSceneDB；本迁移只加列 + 用存量数据补算。
-- =============================================================

ALTER TABLE room_scenes ADD COLUMN IF NOT EXISTS content_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN room_scenes.content_updated_at IS
  'REQ-065：画布内容最后修改时间（元素 updated 字段最大值，不晚于落库时刻）；与 updated_at（最近落库时间）不同';

-- 存量补算：只在为空时填，重复执行无副作用。
-- 元素时间戳来自浏览器时钟，用 LEAST(…, NOW()) 防止时钟偏快的设备写出「未来时间」。
UPDATE room_scenes s
SET content_updated_at = LEAST(NOW(), to_timestamp(m.mx / 1000.0))
FROM (
  SELECT rs.id, max((e->>'updated')::numeric) AS mx
  FROM room_scenes rs,
       jsonb_array_elements(
         CASE WHEN jsonb_typeof(rs.scene_data->'elements') = 'array'
              THEN rs.scene_data->'elements' ELSE '[]'::jsonb END
       ) e
  WHERE (e->>'updated') ~ '^[0-9]+(\.[0-9]+)?$'
  GROUP BY rs.id
) m
WHERE m.id = s.id AND s.content_updated_at IS NULL AND m.mx > 0;
