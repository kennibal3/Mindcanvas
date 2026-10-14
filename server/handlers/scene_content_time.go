package handlers

import "encoding/json"

// sceneContentUpdatedMs REQ-065：返回场景里所有元素 `updated` 字段（毫秒时间戳）的最大值。
//
// Excalidraw 每次修改元素（含移动、改字、删除——删除是把 isDeleted 置真并刷新
// updated）都会刷新该元素的 updated，所以它的最大值就是「画布内容最后一次被改」
// 的时刻。与 room_scenes.updated_at（最近一次落库）不同：房间清空时的强制落库
// （onRoomEmpty）内容没变，这个值也不会变——这正是它存在的理由。
//
// 解析失败、没有元素或没有合法时间戳时返回 0，调用方据此保留旧值不覆盖。
func sceneContentUpdatedMs(sceneJSON []byte) int64 {
	if len(sceneJSON) == 0 {
		return 0
	}
	var scene struct {
		Elements []struct {
			Updated float64 `json:"updated"`
		} `json:"elements"`
	}
	if err := json.Unmarshal(sceneJSON, &scene); err != nil {
		return 0
	}
	var maxMs float64
	for _, el := range scene.Elements {
		if el.Updated > maxMs {
			maxMs = el.Updated
		}
	}
	return int64(maxMs)
}
