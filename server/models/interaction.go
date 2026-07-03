// =============================================================
// MindCanvas v3.0 - 互动记录数据模型
// 对应数据库表：widget_interactions
// 仅追加，不修改（用于投票/词云/问答的学生提交记录）
// =============================================================
package models

import (
	"encoding/json"
	"time"
)

// Interaction 互动记录模型
type Interaction struct {
	ID          string          `json:"id"`           // UUID 主键
	ElementID   string          `json:"element_id"`   // 所属组件 ID
	RoomID      string          `json:"room_id"`      // 所属房间 ID
	StudentUUID string          `json:"student_uuid"` // 学生 UUID
	StudentName string          `json:"student_name"` // 学生昵称
	ActionType  string          `json:"action_type"`  // 操作类型
	ActionData  json.RawMessage `json:"action_data"`  // 操作数据 JSONB
	IsCorrect   *bool           `json:"is_correct"`   // 是否正确（问答用）
	CreatedAt   time.Time       `json:"created_at"`   // 创建时间
}

// 操作类型常量
const (
	ActionTypeVote    = "vote"     // 投票
	ActionTypeAddWord = "add_word" // 词云添加词汇
	ActionTypeAnswer  = "answer"   // 问答作答
)
