// =============================================================
// MindCanvas v4.1 - Phase 5 课堂流程控制器
// 模型定义：FlowNode、TeachingFlow 及相关请求/响应结构
// =============================================================
package models

import (
	"encoding/json"
	"time"
)

// FlowNodeType 节点类型枚举
type FlowNodeType string

const (
	FlowNodeLecture     FlowNodeType = "lecture"     // 讲授
	FlowNodeDiscussion  FlowNodeType = "discussion"  // 讨论
	FlowNodeInteraction FlowNodeType = "interaction" // 互动（绑定Widget）
	FlowNodeBreak       FlowNodeType = "break"       // 休息
	FlowNodeReview      FlowNodeType = "review"      // 复习/总结
)

// FlowNodeEntryMode 进入节点时画布模式
type FlowNodeEntryMode string

const (
	EntryModeFree     FlowNodeEntryMode = "free"     // 自由模式（学生可操作画布）
	EntryModeReadOnly FlowNodeEntryMode = "readonly" // 只读模式（学生不能操作）
	EntryModeFollow   FlowNodeEntryMode = "follow"   // 跟随模式（学生视口跟随教师）
)

// FlowNode 课堂流程节点
// 存储在 teaching_flows.nodes JSONB数组中
type FlowNode struct {
	ID             string            `json:"id"`              // 节点唯一ID（前端生成UUID）
	Type           FlowNodeType      `json:"type"`            // 节点类型
	Title          string            `json:"title"`           // 节点标题（可对学生展示）
	Duration       int               `json:"duration"`        // 预计时长（分钟）
	Notes          string            `json:"notes"`           // 教师备注（不对学生展示）
	WidgetElementID string           `json:"widgetElementId"` // 绑定的Widget元素ID
	AutoOpenWidget bool              `json:"autoOpenWidget"`  // 进入时提示开启Widget
	ShowToStudents bool              `json:"showToStudents"`  // 是否对学生展示此节点标题
	EntryMode      FlowNodeEntryMode `json:"entryMode"`       // 进入时画布模式
}

// TeachingFlow 课堂流程主体
type TeachingFlow struct {
	ID                    string        `json:"id"`
	RoomID                string        `json:"room_id"`
	Title                 string        `json:"title"`
	Nodes                 []FlowNode    `json:"nodes"`
	CurrentNodeIndex      int           `json:"current_node_index"`
	Status                string        `json:"status"` // draft / active / finished
	ShowProgressToStudents bool         `json:"show_progress_to_students"`
	StartedAt             *time.Time    `json:"started_at,omitempty"`
	FinishedAt            *time.Time    `json:"finished_at,omitempty"`
	CreatedAt             time.Time     `json:"created_at"`
	UpdatedAt             time.Time     `json:"updated_at"`
}

// FlowProgress 学生端可见的进度信息（脱敏：去除备注/绑定信息）
type FlowProgress struct {
	FlowID           string             `json:"flow_id"`
	FlowTitle        string             `json:"flow_title"`
	CurrentNodeIndex int                `json:"current_node_index"`
	TotalNodes       int                `json:"total_nodes"`
	CurrentNode      *FlowNodePublic    `json:"current_node,omitempty"`
	Nodes            []FlowNodePublic   `json:"nodes"`
}

// FlowNodePublic 对学生公开的节点信息（去除教师备注和Widget绑定细节）
type FlowNodePublic struct {
	ID             string       `json:"id"`
	Type           FlowNodeType `json:"type"`
	Title          string       `json:"title"`           // 仅当showToStudents=true时有值
	Duration       int          `json:"duration"`
	ShowToStudents bool         `json:"show_to_students"`
}

// =============================================================
// 请求/响应结构体
// =============================================================

// CreateFlowRequest 创建课堂流程请求
type CreateFlowRequest struct {
	Title                  string     `json:"title"`
	Nodes                  []FlowNode `json:"nodes"`
	ShowProgressToStudents bool       `json:"show_progress_to_students"`
}

// UpdateFlowRequest 更新课堂流程请求（全量覆盖nodes）
type UpdateFlowRequest struct {
	Title                  *string    `json:"title"`
	Nodes                  []FlowNode `json:"nodes"`
	ShowProgressToStudents *bool      `json:"show_progress_to_students"`
}

// AdvanceFlowRequest 推进节点请求
type AdvanceFlowRequest struct {
	// Direction: "next"/"prev"/"jump"
	Direction  string `json:"direction" binding:"required"`
	// TargetIndex: 仅 direction="jump" 时使用
	TargetIndex int   `json:"target_index"`
}

// ParseNodesJSON 将数据库存储的JSONB反序列化为FlowNode切片
func ParseNodesJSON(data []byte) ([]FlowNode, error) {
	var nodes []FlowNode
	if len(data) == 0 || string(data) == "null" {
		return []FlowNode{}, nil
	}
	if err := json.Unmarshal(data, &nodes); err != nil {
		return nil, err
	}
	return nodes, nil
}
