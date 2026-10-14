package handlers

// BUG-056：「只读」「锁定」此前只在前端生效（Excalidraw viewModeEnabled + 隐藏按钮），
// 服务端对学生发来的修改消息照单全收；且前端把老师自己也锁住了，老师打开只读后
// 无法继续编辑，开关形同虚设。本文件是服务端这半边：房间处于只读或锁定时，
// 拦下学生的一切修改与互动（2026-10-14 用户拍板：只读＝学生只能看，投票/答题/
// 交作品/点赞都不行）。老师不受限。

import (
	"database/sql"
	"log"
	"sync"
	"time"

	"mindcanvas-server/ws"
)

// studentMutationMsgTypes 学生能发来、会改动房间内容或互动数据的 WS 消息类型。
// 组件提交（widget_submit）不在此表，按 action 单独判定（见 widgetActionBlocked）。
var studentMutationMsgTypes = map[string]bool{
	ws.MsgSceneUpdate:    true,
	ws.MsgElementCreate:  true,
	ws.MsgElementUpdate:  true,
	ws.MsgElementDelete:  true,
	ws.MsgDrawStroke:     true,
	ws.MsgDropzoneSubmit: true,
	ws.MsgCardLike:       true,
	ws.MsgCardReaction:   true,
}

// studentWriteBlocked 是否拦下这条消息。isRestricted 惰性求值：只有学生发修改类
// 消息时才查房间状态，老师的消息、光标、心跳等一律不查库。
func studentWriteBlocked(role, msgType string, isRestricted func() bool) bool {
	if role != "student" || !studentMutationMsgTypes[msgType] {
		return false
	}
	return isRestricted()
}

// widgetActionBlocked 组件提交的判定。html_event 放行：它只是 HTML 课件内部
// 翻页/点按的记录，不改房间内容，拦掉只会让课件报错。
func widgetActionBlocked(role, actionType string, isRestricted func() bool) bool {
	if role != "student" || actionType == "html_event" {
		return false
	}
	return isRestricted()
}

type roomRestrictEntry struct {
	restricted bool
	at         time.Time
}

// roomRestrictCache 房间只读/锁定状态的短时缓存。学生课堂上自由画图时每次
// scene_update 都要判定，缓存 2 秒避免每条消息查一次库；老师切换开关后最多
// 2 秒生效（前端同时收到 ctrl_readonly / ctrl_lockdown 立刻进入只看状态，
// 这里只是兜底）。
var roomRestrictCache sync.Map

const roomRestrictTTL = 2 * time.Second

// roomIsRestricted 房间当前是否处于只读或锁定。查库失败时放行（fail-open）：
// 前端仍在拦，不能因为一次数据库抖动把正常上课的学生全拦住。
func roomIsRestricted(db *sql.DB, roomID string) bool {
	if v, ok := roomRestrictCache.Load(roomID); ok {
		if e := v.(roomRestrictEntry); time.Since(e.at) < roomRestrictTTL {
			return e.restricted
		}
	}
	if db == nil {
		return false
	}
	var locked, readonly bool
	if err := db.QueryRow(`SELECT is_locked, is_readonly FROM rooms WHERE id = $1`, roomID).
		Scan(&locked, &readonly); err != nil {
		log.Printf("[只读校验] 查询房间状态失败 room:%s err:%v（放行）", roomID, err)
		return false
	}
	restricted := locked || readonly
	roomRestrictCache.Store(roomID, roomRestrictEntry{restricted: restricted, at: time.Now()})
	return restricted
}

// invalidateRoomRestrict 老师切换只读/锁定后立即作废缓存（RoomHandler 调用）。
func invalidateRoomRestrict(roomID string) {
	roomRestrictCache.Delete(roomID)
}
