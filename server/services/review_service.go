// =============================================================
// MindCanvas v4.1 - Phase6 同伴互评服务
// 管理 peer_reviews 表的 CRUD 操作
// 唯一约束：每人对每件作品只能评价一次（数据库层保证）
// =============================================================
package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"
)

// ReviewRequest 创建互评请求
type ReviewRequest struct {
	SubmissionID string         `json:"submission_id" binding:"required"`
	ReviewerUUID string         `json:"reviewer_uuid"`
	Scores       map[string]int `json:"scores"`
	Comment      string         `json:"comment"`
}

// Review 互评记录
type Review struct {
	ID           string         `json:"id"`
	DropzoneID   string         `json:"dropzone_id"`
	SubmissionID string         `json:"submission_id"`
	ReviewerUUID string         `json:"reviewer_uuid"`
	ReviewerName string         `json:"reviewer_name"`
	Scores       map[string]int `json:"scores"`
	Comment      string         `json:"comment"`
	CreatedAt    string         `json:"created_at"`
}

// SubmissionReviewSummary 单个作品的互评汇总
type SubmissionReviewSummary struct {
	SubmissionID string             `json:"submission_id"`
	ReviewCount  int                `json:"review_count"`
	AvgScores    map[string]float64 `json:"avg_scores"` // 各维度平均分
	Reviews      []Review           `json:"reviews"`
}

// ReviewService 互评服务
type ReviewService struct {
	db *sql.DB
}

// NewReviewService 构造函数
func NewReviewService(db *sql.DB) *ReviewService {
	return &ReviewService{db: db}
}

// CreateReview 创建互评
// 利用数据库唯一约束（submission_id, reviewer_uuid）防止重复评价
// ON CONFLICT DO UPDATE 实现"已评价则更新"语义
func (s *ReviewService) CreateReview(dropzoneID string, req ReviewRequest) (*Review, error) {
	// 序列化评分JSON
	scoresJSON := "{}"
	if len(req.Scores) > 0 {
		b, err := json.Marshal(req.Scores)
		if err != nil {
			return nil, fmt.Errorf("评分数据序列化失败: %w", err)
		}
		scoresJSON = string(b)
	}

	var reviewID string
	err := s.db.QueryRow(`
		INSERT INTO peer_reviews (dropzone_id, submission_id, reviewer_uuid, scores, comment)
		VALUES ($1, $2, $3, $4::jsonb, $5)
		ON CONFLICT (submission_id, reviewer_uuid)
		DO UPDATE SET
			scores     = EXCLUDED.scores,
			comment    = EXCLUDED.comment
		RETURNING id
	`, dropzoneID, req.SubmissionID, req.ReviewerUUID, scoresJSON, req.Comment).Scan(&reviewID)
	if err != nil {
		return nil, fmt.Errorf("创建互评失败: %w", err)
	}

	log.Printf("[ReviewService] 互评创建/更新 dropzone:%s submission:%s reviewer:%s",
		dropzoneID, req.SubmissionID, req.ReviewerUUID)

	return s.GetReviewByID(reviewID)
}

// GetReviewByID 按ID获取互评
func (s *ReviewService) GetReviewByID(reviewID string) (*Review, error) {
	var r Review
	var scoresJSON []byte
	var createdAt time.Time

	err := s.db.QueryRow(`
		SELECT id, dropzone_id, submission_id, reviewer_uuid, scores, comment, created_at
		FROM peer_reviews
		WHERE id = $1
	`, reviewID).Scan(
		&r.ID, &r.DropzoneID, &r.SubmissionID,
		&r.ReviewerUUID, &scoresJSON, &r.Comment, &createdAt,
	)
	if err != nil {
		return nil, fmt.Errorf("查询互评失败: %w", err)
	}

	r.Scores = unmarshalScores(scoresJSON)
	r.CreatedAt = createdAt.Format(time.RFC3339)
	return &r, nil
}

// ListReviewsByDropzone 获取某个作品墙组件的所有互评，按submission_id分组汇总
func (s *ReviewService) ListReviewsByDropzone(dropzoneID string) ([]SubmissionReviewSummary, error) {
	rows, err := s.db.Query(`
		SELECT id, submission_id, reviewer_uuid, scores, comment, created_at
		FROM peer_reviews
		WHERE dropzone_id = $1
		ORDER BY submission_id, created_at DESC
	`, dropzoneID)
	if err != nil {
		return nil, fmt.Errorf("查询互评列表失败: %w", err)
	}
	defer rows.Close()

	// 按 submission_id 分组，保持首次出现顺序
	summaryMap := make(map[string]*SubmissionReviewSummary)
	var order []string

	for rows.Next() {
		var r Review
		var scoresJSON []byte
		var createdAt time.Time
		if err := rows.Scan(
			&r.ID, &r.SubmissionID, &r.ReviewerUUID,
			&scoresJSON, &r.Comment, &createdAt,
		); err != nil {
			continue
		}
		r.DropzoneID = dropzoneID
		r.Scores = unmarshalScores(scoresJSON)
		r.CreatedAt = createdAt.Format(time.RFC3339)

		if _, exists := summaryMap[r.SubmissionID]; !exists {
			summaryMap[r.SubmissionID] = &SubmissionReviewSummary{
				SubmissionID: r.SubmissionID,
				Reviews:      []Review{},
				AvgScores:    make(map[string]float64),
			}
			order = append(order, r.SubmissionID)
		}
		summaryMap[r.SubmissionID].Reviews = append(summaryMap[r.SubmissionID].Reviews, r)
	}

	// 计算各维度平均分
	for _, summary := range summaryMap {
		summary.ReviewCount = len(summary.Reviews)
		if summary.ReviewCount > 0 {
			totals := make(map[string]int)
			for _, rv := range summary.Reviews {
				for dim, score := range rv.Scores {
					totals[dim] += score
				}
			}
			for dim, total := range totals {
				summary.AvgScores[dim] = float64(total) / float64(summary.ReviewCount)
			}
		}
	}

	// 按首次出现顺序返回
	result := make([]SubmissionReviewSummary, 0, len(order))
	for _, id := range order {
		result = append(result, *summaryMap[id])
	}
	return result, nil
}

// CheckAlreadyReviewed 检查某学生是否已评价某作品
func (s *ReviewService) CheckAlreadyReviewed(submissionID, reviewerUUID string) (bool, error) {
	var count int
	err := s.db.QueryRow(`
		SELECT COUNT(*) FROM peer_reviews
		WHERE submission_id = $1 AND reviewer_uuid = $2
	`, submissionID, reviewerUUID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// =============================================================
// 工具函数
// =============================================================

// unmarshalScores 反序列化JSON为评分map
func unmarshalScores(data []byte) map[string]int {
	result := make(map[string]int)
	if len(data) == 0 {
		return result
	}
	json.Unmarshal(data, &result)
	return result
}
