// =============================================================
// MindCanvas v4.1 - Phase6 学情雷达处理器
// GET  /api/rooms/:id/insight         教师查看学情雷达
// POST /api/rooms/:id/insight/refresh 手动刷新（清除Redis缓存）
// ⭐ 修复：不再传 onlineCount 参数，hub 已在 InsightService 注入
// =============================================================
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/services"
)

// InsightHandler 学情雷达处理器
type InsightHandler struct {
	insightService *services.InsightService
}

// NewInsightHandler 构造函数
func NewInsightHandler(insightService *services.InsightService) *InsightHandler {
	return &InsightHandler{insightService: insightService}
}

// GetInsight 获取学情雷达数据
func (h *InsightHandler) GetInsight(c *gin.Context) {
	roomID := c.Param("id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "房间ID不能为空"})
		return
	}
	data, err := h.insightService.GetInsight(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取学情数据失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"insight": data})
}

// RefreshInsight 手动刷新学情雷达
func (h *InsightHandler) RefreshInsight(c *gin.Context) {
	roomID := c.Param("id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "房间ID不能为空"})
		return
	}
	h.insightService.InvalidateInsightCache(roomID)
	data, err := h.insightService.GetInsight(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "刷新学情数据失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"insight": data, "refreshed": true})
}
