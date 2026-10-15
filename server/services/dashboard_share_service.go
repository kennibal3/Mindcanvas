// =============================================================
// REQ-066 一期：看板分享服务
// 每个房间一个免登录永久链接（/board/:token），展示房间里指定 HTML 看板组件的最新内容。
// 与 share_service.go 的「发布分享」（课堂统计/作品墙）并存、互不读写对方的表。
// =============================================================
package services

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"
)

var (
	// ErrDashboardShareNotFound 链接不存在或已停用
	ErrDashboardShareNotFound = errors.New("看板链接不存在或已停用")
	// ErrDashboardGone 链接还在，但它指向的看板组件已被删除
	ErrDashboardGone = errors.New("这个看板已被删除，请联系分享人")
	// ErrDashboardElementInvalid 选的组件不是本房间的 HTML 看板
	ErrDashboardElementInvalid = errors.New("所选组件不是本房间的 HTML 看板")
	// ErrNoDashboardCandidate 房间里没有可分享的 HTML 看板
	ErrNoDashboardCandidate = errors.New("房间里还没有 HTML 看板组件")
)

// DashboardShare 房间的看板分享记录
type DashboardShare struct {
	ID        string    `json:"id"`
	RoomID    string    `json:"room_id"`
	ElementID *string   `json:"element_id"`
	Token     string    `json:"share_token"`
	ViewCount int       `json:"view_count"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// DashboardCandidate 房间里可被分享的 HTML 看板组件
type DashboardCandidate struct {
	ElementID string    `json:"element_id"`
	Title     string    `json:"title"`
	UpdatedAt time.Time `json:"updated_at"`
	ByteSize  int       `json:"byte_size"`
}

// PublicBoard 公开页需要的数据
type PublicBoard struct {
	RoomTitle string    `json:"room_title"`
	Title     string    `json:"title"`
	HTML      string    `json:"html"`
	UpdatedAt time.Time `json:"updated_at"`
}

type DashboardShareService struct {
	db *sql.DB
}

func NewDashboardShareService(db *sql.DB) *DashboardShareService {
	return &DashboardShareService{db: db}
}

// candidateFilter 可分享的看板＝本房间未删除、有内联 HTML 源码的 html_widget。
// zip 课件包（REQ-059）没有 html_widget_contents 行或源码为空，自然被排除。
const candidateFilter = `h.room_id = $1 AND e.is_deleted = FALSE AND e.type = 'html_widget' AND h.byte_size > 0`

// ListCandidates 按源码最近更新时间倒序列出房间里的 HTML 看板（第一个即默认选项）
func (s *DashboardShareService) ListCandidates(roomID string) ([]DashboardCandidate, error) {
	rows, err := s.db.Query(`
		SELECT h.element_id, COALESCE(NULLIF(e.payload->'payload'->>'title', ''), 'HTML 展示'), h.updated_at, h.byte_size
		FROM html_widget_contents h JOIN room_elements e ON e.id = h.element_id
		WHERE `+candidateFilter+`
		ORDER BY h.updated_at DESC`, roomID)
	if err != nil {
		return nil, fmt.Errorf("查询看板组件失败: %w", err)
	}
	defer rows.Close()
	out := []DashboardCandidate{}
	for rows.Next() {
		var c DashboardCandidate
		if err := rows.Scan(&c.ElementID, &c.Title, &c.UpdatedAt, &c.ByteSize); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetByRoom 房间当前的看板分享；没有时返回 nil, nil
func (s *DashboardShareService) GetByRoom(roomID string) (*DashboardShare, error) {
	var d DashboardShare
	err := s.db.QueryRow(`
		SELECT id, room_id, element_id::text, share_token, view_count, created_at, updated_at
		FROM room_dashboard_shares WHERE room_id = $1`, roomID,
	).Scan(&d.ID, &d.RoomID, &d.ElementID, &d.Token, &d.ViewCount, &d.CreatedAt, &d.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("查询看板分享失败: %w", err)
	}
	return &d, nil
}

// Upsert 生成或更新房间的看板链接。elementID 为空时取最近更新的看板。
// 已有链接时只改 element_id，token 不变——已经发出去的链接继续有效。
func (s *DashboardShareService) Upsert(roomID, elementID, userID string) (*DashboardShare, error) {
	if elementID == "" {
		cands, err := s.ListCandidates(roomID)
		if err != nil {
			return nil, err
		}
		if len(cands) == 0 {
			return nil, ErrNoDashboardCandidate
		}
		elementID = cands[0].ElementID
	} else {
		var ok bool
		if err := s.db.QueryRow(`
			SELECT EXISTS(SELECT 1 FROM html_widget_contents h JOIN room_elements e ON e.id = h.element_id
			WHERE `+candidateFilter+` AND h.element_id = $2)`, roomID, elementID).Scan(&ok); err != nil {
			return nil, fmt.Errorf("校验看板组件失败: %w", err)
		}
		if !ok {
			return nil, ErrDashboardElementInvalid
		}
	}

	existing, err := s.GetByRoom(roomID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		if _, err := s.db.Exec(`UPDATE room_dashboard_shares SET element_id = $1, updated_at = NOW() WHERE id = $2`,
			elementID, existing.ID); err != nil {
			return nil, fmt.Errorf("更新看板分享失败: %w", err)
		}
		log.Printf("[看板分享] 更新 room:%s element:%s token:%s", roomID, elementID, existing.Token)
		return s.GetByRoom(roomID)
	}

	token, err := generateShareToken()
	if err != nil {
		return nil, fmt.Errorf("生成链接失败: %w", err)
	}
	var createdBy interface{}
	if userID != "" {
		createdBy = userID
	}
	if _, err := s.db.Exec(`
		INSERT INTO room_dashboard_shares (room_id, element_id, share_token, created_by)
		VALUES ($1, $2, $3, $4)`, roomID, elementID, token, createdBy); err != nil {
		return nil, fmt.Errorf("创建看板分享失败: %w", err)
	}
	log.Printf("[看板分享] 新建 room:%s element:%s token:%s", roomID, elementID, token)
	return s.GetByRoom(roomID)
}

// Delete 停用房间的看板链接（删除记录，旧链接即失效）
func (s *DashboardShareService) Delete(roomID string) error {
	if _, err := s.db.Exec(`DELETE FROM room_dashboard_shares WHERE room_id = $1`, roomID); err != nil {
		return fmt.Errorf("停用看板分享失败: %w", err)
	}
	log.Printf("[看板分享] 停用 room:%s", roomID)
	return nil
}

// GetPublic 公开页取数：每次都读最新源码（不缓存——「实时」是用户的核心诉求）。
func (s *DashboardShareService) GetPublic(token string) (*PublicBoard, error) {
	var roomTitle string
	var elementID sql.NullString
	err := s.db.QueryRow(`
		SELECT r.title, d.element_id::text
		FROM room_dashboard_shares d JOIN rooms r ON r.id = d.room_id
		WHERE d.share_token = $1`, token).Scan(&roomTitle, &elementID)
	if err == sql.ErrNoRows {
		return nil, ErrDashboardShareNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("查询看板链接失败: %w", err)
	}
	if !elementID.Valid {
		return nil, ErrDashboardGone
	}
	b := &PublicBoard{RoomTitle: roomTitle}
	err = s.db.QueryRow(`
		SELECT COALESCE(NULLIF(e.payload->'payload'->>'title', ''), 'HTML 展示'), h.html, h.updated_at
		FROM html_widget_contents h JOIN room_elements e ON e.id = h.element_id
		WHERE h.element_id = $1 AND e.is_deleted = FALSE`, elementID.String).Scan(&b.Title, &b.HTML, &b.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, ErrDashboardGone
	}
	if err != nil {
		return nil, fmt.Errorf("读取看板内容失败: %w", err)
	}
	if _, err := s.db.Exec(`UPDATE room_dashboard_shares SET view_count = view_count + 1 WHERE share_token = $1`, token); err != nil {
		log.Printf("[看板分享] 访问计数失败 token:%s err:%v", token, err)
	}
	return b, nil
}
