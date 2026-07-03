// =============================================================
// MindCanvas v3.0 - 学生入场处理器
// 功能：免注册入场、跨设备认领
// =============================================================
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/models"
	"mindcanvas-server/services"
)

// GuestHandler 学生入场处理器
type GuestHandler struct {
	sessionService *services.SessionService
}

// NewGuestHandler 创建学生入场处理器
func NewGuestHandler(sessionService *services.SessionService) *GuestHandler {
	return &GuestHandler{sessionService: sessionService}
}

// JoinRoom 学生入场
// POST /api/guest/join
func (h *GuestHandler) JoinRoom(c *gin.Context) {
	var req models.JoinRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "参数错误",
			"message": "房间码和昵称不能为空",
		})
		return
	}

	// 获取客户端 IP
	ipAddress := c.ClientIP()

	// 调用会话服务入场
	resp, err := h.sessionService.JoinRoom(&req, ipAddress)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "入场失败",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "入场成功",
		"data":    resp,
	})
}

// GenerateReclaimCode 生成跨设备认领码
// POST /api/guest/reclaim/generate
func (h *GuestHandler) GenerateReclaimCode(c *gin.Context) {
	// 从请求中获取当前 UUID
	var req struct {
		UUID string `json:"uuid" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误", "message": "UUID 不能为空"})
		return
	}

	resp, err := h.sessionService.GenerateReclaimCode(req.UUID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成失败", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "认领码已生成",
		"data":    resp,
	})
}

// VerifyReclaimCode 验证认领码
// POST /api/guest/reclaim/verify
func (h *GuestHandler) VerifyReclaimCode(c *gin.Context) {
	var req models.ReclaimVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误", "message": "认领码不能为空"})
		return
	}

	uuid, err := h.sessionService.VerifyReclaimCode(req.Code)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "验证失败", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "认领成功",
		"uuid":    uuid,
	})
}
