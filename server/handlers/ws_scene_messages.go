// =============================================================
// MindCanvas - scene_update 相关消息与删除权限决策（从 SetupMessageHandler 抽出的纯函数）
// 目的（REQ-054）：把「scene_update / scene_restore 长什么样」「越权删除时到底恢复还是放行」
//       变成可被单测锁住的契约，而不是埋在消息处理闭包里的内联 map 与分支。
// 契约（前端消费点：useWebSocket.ts 的 case 'scene_update' / 'scene_restore'，
//       CanvasEngine.tsx 读 detail.illegal_ids）：
//   scene_update  ：{type, data:<过滤后的场景 payload>, from:<发送者 UUID>}
//   scene_restore ：{type, data:{illegal_ids:[...]}}，只回发给删除者本人
// 抽取为纯搬运：字段名、字段值、判断顺序与原内联代码完全一致，
// 只有 h.isTeamRoom（要查库）改为由调用方以函数形式传入，以便无数据库地测试。
// =============================================================

package handlers

import "mindcanvas-server/ws"

// sceneDeleteGuardOutcome 是越权删除检查的结论
type sceneDeleteGuardOutcome int

const (
	// guardNoIllegal 没有越权删除（含：教师发送、学生只删自己的）
	guardNoIllegal sceneDeleteGuardOutcome = iota
	// guardRestored 非团队房，越权删除已被翻回未删除，需要把 illegalIDs 回发给删除者
	guardRestored
	// guardTeamAllowed REQ-046 团队协作形态：人人可删他人元素，放行、不恢复、不回弹
	guardTeamAllowed
)

// buildSceneRestoreMessage 构造回发给删除者本人的 scene_restore 消息
func buildSceneRestoreMessage(illegalIDs []string) map[string]interface{} {
	return map[string]interface{}{
		"type": "scene_restore",
		"data": map[string]interface{}{"illegal_ids": illegalIDs},
	}
}

// buildSceneUpdateMessage 构造向房间其他人广播的 scene_update 消息
func buildSceneUpdateMessage(payload map[string]interface{}, senderUUID string) map[string]interface{} {
	return map[string]interface{}{
		"type": ws.MsgSceneUpdate,
		"data": payload,
		"from": senderUUID,
	}
}

// resolveSceneDeleteGuard 对一条 scene_update 做删除权限决策。
//   - 返回的 payload：非团队房且有越权删除时是已恢复越权项的版本，其余情况原样返回
//   - 返回的 illegalIDs：validateDeletePermissions 找出的越权删除 ID（保持原顺序）
//   - isTeamRoom 是函数而不是布尔值：只在确有越权删除时才调用（它要查库，罕见路径才付这笔代价）
func resolveSceneDeleteGuard(
	senderUUID string,
	senderIsStudent bool,
	payload map[string]interface{},
	isTeamRoom func() bool,
) (map[string]interface{}, []string, sceneDeleteGuardOutcome) {
	illegalIDs := validateDeletePermissions(senderUUID, senderIsStudent, payload)
	if len(illegalIDs) == 0 {
		return payload, illegalIDs, guardNoIllegal
	}
	if isTeamRoom() {
		return payload, illegalIDs, guardTeamAllowed
	}
	return filterIllegalDeletes(payload, illegalIDs), illegalIDs, guardRestored
}
