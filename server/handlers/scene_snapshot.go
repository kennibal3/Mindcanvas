// =============================================================
// MindCanvas · BUG-020 一期：画布删除的服务端兜底
//
// 2026-08-11 生产事故：房间 5f160f5d 的 675 个元素里，全部 286 个存活元素被
// 一次操作标记 isDeleted，画布清空。数据救得回来纯属侥幸——
// throttledPersistSceneDB 的 30 秒节流让 PostgreSQL 那份落后了 12 秒，
// 恰好停在删除之前。一个我们从没设计过的副作用成了唯一的安全网。
//
// 本文件把那份运气变成机制，三件事：
//  1. 删除审计   —— 任何带 isDeleted 的 scene_update 都留一行日志。
//     事故当天完全查不到「谁在什么时候删了什么」，因为
//     validateDeletePermissions 对教师第一行就 return nil，
//     而 [删除校验] 日志只在判定越权时才打（ws_handler.go:417）。
//  2. 大批量熔断 —— 删除量达阈值、或吃掉半数以上存活元素时打 WARN。
//  3. 删除前快照 —— 把**合并前**的场景整份留档，这是「可撤销」的地基（REQ-060）。
//
// 三条全部旁路：任何一步失败只记日志，绝不影响正常编辑与同步。
// 沿用 REQ-050 B 采集的纪律——观测代码不许成为主流程的新故障源。
//
// ⚠️ 与 BUG-021 的次序约束：本文件上线并验证之前，不许去修
// throttledPersistSceneDB 的 30 秒节流。那个节流目前是唯一的意外安全网，
// 先修它等于在没有安全网的情况下把安全网拆掉。
// =============================================================
package handlers

import (
	"context"
	"encoding/json"
	"log"
	"time"
)

const (
	// 触发快照的绝对删除数。低于此值走比例判定——日常删几个图形不该每次
	// 都留一份 600KB 的快照，那会把快照表变成噪音，真出事时反而不好找。
	snapshotDeleteThreshold = 20

	// 触发快照的比例：本次删除吃掉了合并前存活元素的多少。
	// 有这一条，小画布被清空（比如只有 8 个元素全删）同样会留档，
	// 不会因为绝对数没到 20 就漏掉。
	snapshotDeleteRatio = 0.5

	// 同一房间两份快照之间的最小间隔。Excalidraw 删除大量元素时会连发多个
	// scene_update，节流保证留下的是**第一份**——也就是唯一还没被删干净的那份。
	// 后续几份留下来只会是「已经删了一半」的中间态，没有恢复价值。
	snapshotThrottle = 60 * time.Second

	// 每个房间保留的快照份数。单房间场景实测已达 636KB，不设上限会涨疯。
	snapshotKeepPerRoom = 20
)

// countDeletedElements 统计本次 scene_update 里带 isDeleted 标记的元素数。
// 注意这是「本次消息声明要删的数量」，不是「实际生效的数量」——
// merge 时同 id 低版本的删除会被丢弃。用于告警和阈值判定足够，
// 不要拿它当精确的审计数字。
func countDeletedElements(payload map[string]interface{}) int {
	elements, ok := payload["elements"].([]interface{})
	if !ok {
		return 0
	}
	n := 0
	for _, e := range elements {
		elem, ok := e.(map[string]interface{})
		if !ok {
			continue
		}
		if isDeleted, _ := elem["isDeleted"].(bool); isDeleted {
			n++
		}
	}
	return n
}

// countLiveElements 数一份场景 JSON 里还活着的元素。
// 事故当天就是靠「DB 存活 286 / Redis 存活 0」这一对数字定的性，
// 所以这个数值本身要进日志，不只是拿来算阈值。
func countLiveElements(sceneJSON []byte) int {
	if len(sceneJSON) < 2 {
		return 0
	}
	var scene map[string]interface{}
	if err := json.Unmarshal(sceneJSON, &scene); err != nil {
		return 0
	}
	elements, ok := scene["elements"].([]interface{})
	if !ok {
		return 0
	}
	n := 0
	for _, e := range elements {
		elem, ok := e.(map[string]interface{})
		if !ok {
			continue
		}
		if isDeleted, _ := elem["isDeleted"].(bool); !isDeleted {
			n++
		}
	}
	return n
}

// shouldSnapshot 判断这次删除够不够格留一份档。
// 两个条件取或：绝对量够大，或者比例够狠。
func shouldSnapshot(delCount, liveBefore int) bool {
	if delCount <= 0 {
		return false
	}
	if delCount >= snapshotDeleteThreshold {
		return true
	}
	if liveBefore > 0 && float64(delCount) >= float64(liveBefore)*snapshotDeleteRatio {
		return true
	}
	return false
}

// snapshotScene 把删除发生前的场景整份留档。
//
// before 必须是**合并之前**从 Redis 取出的那份。合并之后删除已经生效，
// 再留档就只是把删空的结果存了一遍，毫无意义——这是本函数唯一容易写错的地方。
func (h *WSHandler) snapshotScene(roomID string, before []byte, delCount, liveBefore int, triggerUUID, triggerRole string) {
	if h.db == nil || len(before) < 2 {
		return
	}

	// 节流：连发的 scene_update 只留第一份。用 SetNX 与 throttledPersistSceneDB
	// 同一套手法，Redis 不可用时不节流（宁可多留几份，也不要一份都不留）。
	if h.rdb != nil {
		ctx := context.Background()
		ok, err := h.rdb.SetNX(ctx, "scene:snapshot:"+roomID, "1", snapshotThrottle).Result()
		if err == nil && !ok {
			return
		}
	}

	_, err := h.db.Exec(`
		INSERT INTO room_scene_snapshots
			(room_id, scene_data, data_size, element_count, deleted_count, reason, trigger_uuid, trigger_role)
		VALUES ($1, $2::JSONB, $3, $4, $5, 'bulk_delete', $6, $7)
	`, roomID, string(before), len(before), liveBefore, delCount, triggerUUID, triggerRole)
	if err != nil {
		// 旁路：留档失败绝不能影响这次编辑本身，只记日志。
		log.Printf("[画布快照] ⛔ 写入失败 room:%s err:%v", roomID, err)
		return
	}

	log.Printf("[画布快照] ✅ 已留档 room:%s size:%d 合并前存活:%d 本次删除:%d 触发者:%s(%s)",
		roomID, len(before), liveBefore, delCount, triggerUUID, triggerRole)

	h.pruneSnapshots(roomID)
}

// pruneSnapshots 每房间只保留最近 snapshotKeepPerRoom 份。
// 不做全局定时任务，就地清理最简单也最不容易忘——定时任务是另一个要维护的东西，
// 而这张表的增长完全由「有人删了很多东西」驱动，就地清理天然跟得上。
func (h *WSHandler) pruneSnapshots(roomID string) {
	if h.db == nil {
		return
	}
	_, err := h.db.Exec(`
		DELETE FROM room_scene_snapshots
		 WHERE room_id = $1
		   AND id NOT IN (
		       SELECT id FROM room_scene_snapshots
		        WHERE room_id = $1
		        ORDER BY created_at DESC
		        LIMIT $2
		   )
	`, roomID, snapshotKeepPerRoom)
	if err != nil {
		log.Printf("[画布快照] 清理旧快照失败 room:%s err:%v", roomID, err)
	}
}
