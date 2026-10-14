// =============================================================
// REQ-066 一期：看板分享接口
//
//	教师（需登录 + 房间归属）：
//	  GET    /api/rooms/:id/dashboard-share   当前链接 + 可选看板列表（最近更新在前）
//	  PUT    /api/rooms/:id/dashboard-share   生成/更新链接 {element_id?}，不传则取最近更新的看板
//	  DELETE /api/rooms/:id/dashboard-share   停用链接
//	公开（免登录）：
//	  GET    /api/board/:token                看板最新内容（前端在 sandbox iframe 里渲染）
//
// =============================================================
package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/middleware"
	"mindcanvas-server/services"
)

type DashboardShareHandler struct {
	svc         *services.DashboardShareService
	roomService *services.RoomService
}

func NewDashboardShareHandler(svc *services.DashboardShareService, roomService *services.RoomService) *DashboardShareHandler {
	return &DashboardShareHandler{svc: svc, roomService: roomService}
}

func (h *DashboardShareHandler) checkOwner(c *gin.Context) (string, bool) {
	roomID := c.Param("id")
	if err := h.roomService.CheckRoomOwnership(roomID, middleware.GetUserID(c), middleware.GetRole(c), middleware.GetTenantID(c)); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return "", false
	}
	return roomID, true
}

// GetRoomDashboardShare GET /api/rooms/:id/dashboard-share
func (h *DashboardShareHandler) GetRoomDashboardShare(c *gin.Context) {
	roomID, ok := h.checkOwner(c)
	if !ok {
		return
	}
	share, err := h.svc.GetByRoom(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	cands, err := h.svc.ListCandidates(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"share": share, "candidates": cands})
}

// PutRoomDashboardShare PUT /api/rooms/:id/dashboard-share
func (h *DashboardShareHandler) PutRoomDashboardShare(c *gin.Context) {
	roomID, ok := h.checkOwner(c)
	if !ok {
		return
	}
	var req struct {
		ElementID string `json:"element_id"`
	}
	_ = c.ShouldBindJSON(&req) // 空 body 合法：取最近更新的看板
	share, err := h.svc.Upsert(roomID, req.ElementID, middleware.GetUserID(c))
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, services.ErrDashboardElementInvalid) || errors.Is(err, services.ErrNoDashboardCandidate) {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"share": share})
}

// DeleteRoomDashboardShare DELETE /api/rooms/:id/dashboard-share
func (h *DashboardShareHandler) DeleteRoomDashboardShare(c *gin.Context) {
	roomID, ok := h.checkOwner(c)
	if !ok {
		return
	}
	if err := h.svc.Delete(roomID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "看板链接已停用"})
}

// GetPublicBoard GET /api/board/:token（免登录）
func (h *DashboardShareHandler) GetPublicBoard(c *gin.Context) {
	b, err := h.svc.GetPublic(c.Param("token"))
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, services.ErrDashboardShareNotFound) || errors.Is(err, services.ErrDashboardGone) {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	// 「实时」：不让浏览器或中间代理缓存，领导每次打开/刷新都拿最新一版
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, b)
}
