// =============================================================
// MindCanvas v4.1 - Phase6 同伴互评处理器
// POST /api/rooms/:id/elements/:eid/reviews  提交互评
// GET  /api/rooms/:id/elements/:eid/reviews  获取互评列表
// 评价者身份：教师从JWT Cookie取user_id，学生从Header X-Student-UUID取
// =============================================================
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"mindcanvas-server/services"
)

// ReviewHandler 互评处理器
type ReviewHandler struct {
	reviewService *services.ReviewService
}

// NewReviewHandler 构造函数
func NewReviewHandler(reviewService *services.ReviewService) *ReviewHandler {
	return &ReviewHandler{reviewService: reviewService}
}

// resolveReviewerUUID 解析评价者身份
// 优先顺序：1.请求体显式传入 2.JWT Cookie教师 3.X-Student-UUID Header学生
func resolveReviewerUUID(c *gin.Context, reqUUID string) string {
	if reqUUID != "" {
		return reqUUID
	}
	cookie, err := c.Cookie("mc_token")
	if err == nil && cookie != "" {
		token, _ := jwt.Parse(cookie, func(t *jwt.Token) (interface{}, error) {
			return nil, nil
		})
		if token != nil {
			if claims, ok := token.Claims.(jwt.MapClaims); ok {
				if userID, ok := claims["user_id"].(string); ok && userID != "" {
					return userID
				}
			}
		}
	}
	if uuid := c.GetHeader("X-Student-UUID"); uuid != "" {
		return uuid
	}
	return ""
}

// CreateReview 提交互评
// POST /api/rooms/:id/elements/:eid/reviews
func (h *ReviewHandler) CreateReview(c *gin.Context) {
	dropzoneID := c.Param("eid")
	if dropzoneID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "元素ID不能为空"})
		return
	}
	var req services.ReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误: " + err.Error()})
		return
	}
	req.ReviewerUUID = resolveReviewerUUID(c, req.ReviewerUUID)
	if req.ReviewerUUID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无法识别评价者身份"})
		return
	}
	if req.SubmissionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "submission_id不能为空"})
		return
	}
	review, err := h.reviewService.CreateReview(dropzoneID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "提交互评失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"review": review, "message": "互评提交成功"})
}

// ListReviews 获取某作品墙的所有互评汇总
// GET /api/rooms/:id/elements/:eid/reviews
func (h *ReviewHandler) ListReviews(c *gin.Context) {
	dropzoneID := c.Param("eid")
	if dropzoneID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "元素ID不能为空"})
		return
	}
	summaries, err := h.reviewService.ListReviewsByDropzone(dropzoneID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取互评数据失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reviews": summaries, "total": len(summaries)})
}
