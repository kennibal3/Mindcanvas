// =============================================================
// MindCanvas v3.0 - 房间元素数据模型
// 对应数据库表：room_elements
// payload 为 JSONB 灵活存储，不同类型有不同字段
// =============================================================
package models

import (
	"encoding/json"
	"time"
)

// Element 房间元素模型
type Element struct {
	ID          string          `json:"id"`           // UUID 主键
	RoomID      string          `json:"room_id"`      // 所属房间 ID
	CreatorUUID string          `json:"creator_uuid"` // 创建者 UUID
	CreatorName string          `json:"creator_name"` // 创建者名称
	Type        string          `json:"type"`         // 元素类型
	Payload     json.RawMessage `json:"payload"`      // JSONB 灵活数据
	IsDeleted   bool            `json:"is_deleted"`   // 软删除标记
	CreatedAt   time.Time       `json:"created_at"`   // 创建时间
	UpdatedAt   time.Time       `json:"updated_at"`   // 更新时间
}

// 元素类型常量
const (
	ElementTypeTextCard          = "text_card"          // 文本卡片
	ElementTypeImageCard         = "image_card"         // 图片卡片
	ElementTypeVideoCard         = "video_card"         // 视频卡片
	ElementTypeFileCard          = "file_card"          // 文件卡片
	ElementTypePollingWidget     = "polling_widget"     // 投票组件
	ElementTypeWordCloudWidget   = "wordcloud_widget"   // 词云组件
	ElementTypeQAWidget          = "qa_widget"          // 问答组件
	ElementTypeExcalidrawStroke  = "excalidraw_stroke"  // 画笔轨迹
	ElementTypeDropzone          = "dropzone"           // 收集区
	ElementTypeHtmlWidget        = "html_widget"        // REQ-041 HTML 展示组件
)
