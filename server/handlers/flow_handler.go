// =============================================================
// MindCanvas v4.1 - Phase 5 课堂流程控制器
// 处理器层：课堂流程API（CRUD + 推进 + 学生端进度）
// =============================================================
package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/middleware"
	"mindcanvas-server/models"
	"mindcanvas-server/services"
	"mindcanvas-server/ws"
)

// FlowHandler 课堂流程处理器
type FlowHandler struct {
	flowService *services.FlowService
	roomService *services.RoomService
	hub         *ws.Hub
}

// NewFlowHandler 构造函数
func NewFlowHandler(
	flowService *services.FlowService,
	roomService *services.RoomService,
	hub *ws.Hub,
) *FlowHandler {
	return &FlowHandler{
		flowService: flowService,
		roomService: roomService,
		hub:         hub,
	}
}

// =============================================================
// 教师端 API（需要认证 + 房间归属校验）
// =============================================================

// GetFlow GET /api/rooms/:id/flow
// 获取房间当前流程（教师端，含完整节点信息）
func (h *FlowHandler) GetFlow(c *gin.Context) {
	roomID := c.Param("id")

	flow, err := h.flowService.GetFlowByRoom(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取流程失败: " + err.Error()})
		return
	}

	// 没有流程时返回空对象而非404，前端据此展示「创建流程」入口
	if flow == nil {
		c.JSON(http.StatusOK, gin.H{"flow": nil, "has_flow": false})
		return
	}

	c.JSON(http.StatusOK, gin.H{"flow": flow, "has_flow": true})
}

// ListFlows GET /api/rooms/:id/flows
// 获取房间所有流程（含历史记录）
func (h *FlowHandler) ListFlows(c *gin.Context) {
	roomID := c.Param("id")

	flows, err := h.flowService.ListFlowsByRoom(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取流程列表失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"flows": flows, "total": len(flows)})
}

// CreateFlow POST /api/rooms/:id/flow
// 创建课堂流程（同时将旧 draft/active 流程归档）
func (h *FlowHandler) CreateFlow(c *gin.Context) {
	roomID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)

	// 校验房间归属
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	var req models.CreateFlowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误"})
		return
	}

	// 节点数量上限校验（防止超大请求）
	if len(req.Nodes) > 50 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "节点数量不能超过50个"})
		return
	}

	flow, err := h.flowService.CreateFlow(roomID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建流程失败: " + err.Error()})
		return
	}

	log.Printf("[FlowHandler] 创建流程 room:%s flow:%s", roomID, flow.ID)
	c.JSON(http.StatusCreated, gin.H{"flow": flow, "message": "流程创建成功"})
}

// UpdateFlow PUT /api/rooms/:id/flow/:fid
// 更新流程（全量覆盖，draft和active状态均可编辑）
func (h *FlowHandler) UpdateFlow(c *gin.Context) {
	roomID := c.Param("id")
	flowID := c.Param("fid")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)

	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	var req models.UpdateFlowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误"})
		return
	}

	if req.Nodes != nil && len(req.Nodes) > 50 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "节点数量不能超过50个"})
		return
	}

	flow, err := h.flowService.UpdateFlow(flowID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 若当前是active状态，通过WS广播流程更新（课中同步）
	if flow.Status == "active" {
		h.broadcastFlowUpdate(roomID, flow, "flow_updated")
	}

	c.JSON(http.StatusOK, gin.H{"flow": flow, "message": "流程更新成功"})
}

// DeleteFlow DELETE /api/rooms/:id/flow/:fid
// 删除流程（仅draft状态）
func (h *FlowHandler) DeleteFlow(c *gin.Context) {
	roomID := c.Param("id")
	flowID := c.Param("fid")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)

	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	if err := h.flowService.DeleteFlow(flowID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	log.Printf("[FlowHandler] 删除流程 room:%s flow:%s", roomID, flowID)
	c.JSON(http.StatusOK, gin.H{"message": "流程已删除"})
}

// ActivateFlow POST /api/rooms/:id/flow/:fid/activate
// 开始上课：draft → active，重置节点到第0个
func (h *FlowHandler) ActivateFlow(c *gin.Context) {
	roomID := c.Param("id")
	flowID := c.Param("fid")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)

	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	flow, err := h.flowService.ActivateFlow(flowID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 广播流程开始（包含学生端进度信息）
	h.broadcastFlowUpdate(roomID, flow, "flow_started")

	log.Printf("[FlowHandler] 流程激活 room:%s flow:%s", roomID, flowID)
	c.JSON(http.StatusOK, gin.H{"flow": flow, "message": "课堂流程已开始"})
}

// AdvanceFlow POST /api/rooms/:id/flow/:fid/advance
// 推进节点：next/prev/jump
func (h *FlowHandler) AdvanceFlow(c *gin.Context) {
	roomID := c.Param("id")
	flowID := c.Param("fid")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)

	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	var req models.AdvanceFlowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误：direction 必填"})
		return
	}

	flow, err := h.flowService.AdvanceFlow(flowID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 广播节点变更（学生端进度条更新）
	h.broadcastFlowUpdate(roomID, flow, "flow_advanced")

	// 若当前节点绑定了Widget且设置了autoOpenWidget，广播提示（教师端弹出确认）
	if flow.Status == "active" && flow.CurrentNodeIndex < len(flow.Nodes) {
		currentNode := flow.Nodes[flow.CurrentNodeIndex]
		if currentNode.WidgetElementID != "" && currentNode.AutoOpenWidget {
			h.hub.BroadcastToRoom(roomID, ws.Message{
				Type: ws.MsgCtrlFlowWidgetHint,
				Payload: map[string]interface{}{
					"node_id":           currentNode.ID,
					"node_title":        currentNode.Title,
					"widget_element_id": currentNode.WidgetElementID,
					"auto_open":         currentNode.AutoOpenWidget,
				},
			})
		}
	}

	log.Printf("[FlowHandler] 节点推进 room:%s flow:%s direction:%s index:%d",
		roomID, flowID, req.Direction, flow.CurrentNodeIndex)
	c.JSON(http.StatusOK, gin.H{
		"flow":              flow,
		"current_node_index": flow.CurrentNodeIndex,
		"message":           "节点已推进",
	})
}

// FinishFlow POST /api/rooms/:id/flow/:fid/finish
// 手动结束流程（active → finished）
func (h *FlowHandler) FinishFlow(c *gin.Context) {
	roomID := c.Param("id")
	flowID := c.Param("fid")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)

	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	flow, err := h.flowService.FinishFlow(flowID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 广播流程结束（学生端进度条隐藏）
	h.hub.BroadcastToRoom(roomID, ws.Message{
		Type:    ws.MsgCtrlFlowUpdate,
		Payload: map[string]interface{}{"status": "finished", "flow_id": flowID},
	})

	log.Printf("[FlowHandler] 流程结束 room:%s flow:%s", roomID, flowID)
	c.JSON(http.StatusOK, gin.H{"flow": flow, "message": "课堂流程已结束"})
}

// UpdateShowProgress PATCH /api/rooms/:id/flow/:fid/progress-visibility
// 切换学生端进度条显示开关（课中实时调整）
func (h *FlowHandler) UpdateShowProgress(c *gin.Context) {
	roomID := c.Param("id")
	flowID := c.Param("fid")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)

	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	var req struct {
		Show bool `json:"show"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	if err := h.flowService.UpdateShowProgress(flowID, req.Show); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 广播给学生端：显示或隐藏进度条
	payload := map[string]interface{}{
		"show_progress": req.Show,
		"flow_id":       flowID,
	}
	if req.Show {
		// 同时推送当前进度数据
		progress, err := h.flowService.GetProgressForStudents(roomID)
		if err == nil && progress != nil {
			payload["progress"] = progress
		}
	}
	h.hub.BroadcastToRoom(roomID, ws.Message{
		Type:    ws.MsgCtrlFlowUpdate,
		Payload: payload,
	})

	c.JSON(http.StatusOK, gin.H{
		"show_progress_to_students": req.Show,
		"message":                   "进度显示设置已更新",
	})
}

// =============================================================
// 学生端 API（无需认证，凭 room_id 访问）
// =============================================================

// GetStudentProgress GET /api/rooms/:id/flow/progress
// 学生端获取当前进度（已脱敏，教师关闭时返回空）
func (h *FlowHandler) GetStudentProgress(c *gin.Context) {
	roomID := c.Param("id")

	// 先检查流程是否开启了学生可见
	flow, err := h.flowService.GetFlowByRoom(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取流程失败"})
		return
	}

	// 流程不存在、未激活、或关闭学生可见时，返回空
	if flow == nil || flow.Status != "active" || !flow.ShowProgressToStudents {
		c.JSON(http.StatusOK, gin.H{"progress": nil, "visible": false})
		return
	}

	progress, err := h.flowService.GetProgressForStudents(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取进度失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"progress": progress, "visible": true})
}

// =============================================================
// 内部辅助函数
// =============================================================

// broadcastFlowUpdate 广播流程状态更新给房间内所有成员
// 学生端根据 show_progress_to_students 决定是否展示
func (h *FlowHandler) broadcastFlowUpdate(roomID string, flow *models.TeachingFlow, event string) {
	payload := map[string]interface{}{
		"event":   event,
		"flow_id": flow.ID,
		"status":  flow.Status,
		"show_progress_to_students": flow.ShowProgressToStudents,
		"current_node_index":        flow.CurrentNodeIndex,
		"total_nodes":               len(flow.Nodes),
	}

	// 若开启了学生进度展示，附带脱敏后的进度数据
	if flow.ShowProgressToStudents && flow.Status == "active" {
		progress, err := h.flowService.GetProgressForStudents(roomID)
		if err == nil && progress != nil {
			payload["progress"] = progress
		}
	}

	h.hub.BroadcastToRoom(roomID, ws.Message{
		Type:    ws.MsgCtrlFlowUpdate,
		Payload: payload,
	})
}
