package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"mindcanvas-server/middleware"
	"mindcanvas-server/services"
	"mindcanvas-server/ws"
)

type ShelfCard struct {
	ID         string    `json:"id"`
	RoomID     string    `json:"room_id"`
	ElementID  string    `json:"element_id"`
	GroupID    *string   `json:"group_id"`
	AuthorUUID string    `json:"author_uuid"`
	AuthorName string    `json:"author_name"`
	CardType   string    `json:"card_type"`
	Content    string    `json:"content"`
	ImageURL   *string   `json:"image_url"`
	LinkURL    *string   `json:"link_url"`
	LinkTitle  *string   `json:"link_title"`
	SortOrder  int       `json:"sort_order"`
	IsHidden   bool      `json:"is_hidden"`
	CreatedAt  time.Time `json:"created_at"`
}

type CreateShelfCardRequest struct {
	GroupID    *string `json:"group_id"`
	CardType   string  `json:"card_type"`
	Content    string  `json:"content"`
	ImageURL   *string `json:"image_url"`
	LinkURL    *string `json:"link_url"`
	LinkTitle  *string `json:"link_title"`
	AuthorUUID string  `json:"author_uuid"`
	AuthorName string  `json:"author_name"`
}

type ShelfHandler struct {
	roomService *services.RoomService
	hub         *ws.Hub
}

func NewShelfHandler(rs *services.RoomService, hub *ws.Hub) *ShelfHandler {
	return &ShelfHandler{roomService: rs, hub: hub}
}

func (h *ShelfHandler) ListShelfCards(c *gin.Context) {
	ctx := c.Request.Context()
	elementID := c.Param("eid")
	groupFilter := c.Query("group_id")
	db := h.roomService.DB()

	var query string
	var args []interface{}
	if groupFilter != "" {
		query = `SELECT id, room_id, element_id, group_id, author_uuid, author_name,
			card_type, content, image_url, link_url, link_title,
			sort_order, is_hidden, created_at
			FROM shelf_cards
			WHERE element_id = $1 AND is_hidden = false
			AND (group_id = $2 OR group_id IS NULL)
			ORDER BY created_at ASC`
		args = []interface{}{elementID, groupFilter}
	} else {
		query = `SELECT id, room_id, element_id, group_id, author_uuid, author_name,
			card_type, content, image_url, link_url, link_title,
			sort_order, is_hidden, created_at
			FROM shelf_cards
			WHERE element_id = $1
			ORDER BY group_id NULLS LAST, created_at ASC`
		args = []interface{}{elementID}
	}

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	cards := []ShelfCard{}
	for rows.Next() {
		var card ShelfCard
		if scanErr := rows.Scan(
			&card.ID, &card.RoomID, &card.ElementID, &card.GroupID,
			&card.AuthorUUID, &card.AuthorName,
			&card.CardType, &card.Content,
			&card.ImageURL, &card.LinkURL, &card.LinkTitle,
			&card.SortOrder, &card.IsHidden, &card.CreatedAt,
		); scanErr != nil {
			continue
		}
		cards = append(cards, card)
	}
	c.JSON(http.StatusOK, gin.H{"cards": cards})
}

func (h *ShelfHandler) CreateShelfCard(c *gin.Context) {
	ctx := c.Request.Context()
	roomID := c.Param("id")
	elementID := c.Param("eid")
	db := h.roomService.DB()

	var req CreateShelfCardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if req.CardType != "text" && req.CardType != "image" && req.CardType != "link" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "card_type 须为 text/image/link"})
		return
	}

	authorUUID := req.AuthorUUID
	authorName := req.AuthorName
	if uid, ok := c.Get("user_id"); ok {
		if s, ok := uid.(string); ok {
			authorUUID = s
		}
		if name, ok := c.Get("username"); ok {
			if s, ok := name.(string); ok {
				authorName = s
			}
		}
	}
	if authorUUID == "" {
		authorUUID = uuid.New().String()
	}

	cardID := uuid.New().String()
	_, err := db.ExecContext(ctx, `
		INSERT INTO shelf_cards
		(id, room_id, element_id, group_id, author_uuid, author_name,
		card_type, content, image_url, link_url, link_title)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		cardID, roomID, elementID, req.GroupID,
		authorUUID, authorName,
		req.CardType, req.Content,
		req.ImageURL, req.LinkURL, req.LinkTitle,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	card := ShelfCard{
		ID: cardID, RoomID: roomID, ElementID: elementID,
		GroupID: req.GroupID, AuthorUUID: authorUUID, AuthorName: authorName,
		CardType: req.CardType, Content: req.Content,
		ImageURL: req.ImageURL, LinkURL: req.LinkURL, LinkTitle: req.LinkTitle,
		CreatedAt: time.Now(),
	}

	msgBytes, _ := json.Marshal(map[string]interface{}{
		"type": ws.MsgShelfCardCreate,
		"data": map[string]interface{}{
			"element_id": elementID,
			"card":       card,
		},
	})
	if room := h.hub.GetRoom(roomID); room != nil {
		room.BroadcastRaw(msgBytes)
	}

	c.JSON(http.StatusCreated, gin.H{"card": card})
}

func (h *ShelfHandler) DeleteShelfCard(c *gin.Context) {
	ctx := c.Request.Context()
	roomID := c.Param("id")
	elementID := c.Param("eid")
	cardID := c.Param("cid")
	db := h.roomService.DB()

	role := middleware.GetRole(c)
	isTeacher := role == "teacher" || role == "admin" || role == "superadmin"

	var (
		n   int64
		err error
	)
	if isTeacher {
		res, e := db.ExecContext(ctx,
			`DELETE FROM shelf_cards WHERE id=$1 AND element_id=$2`,
			cardID, elementID)
		err = e
		if err == nil {
			n, _ = res.RowsAffected()
		}
	} else {
		var body struct {
			AuthorUUID string `json:"author_uuid"`
		}
		_ = c.ShouldBindJSON(&body)
		res, e := db.ExecContext(ctx,
			`DELETE FROM shelf_cards WHERE id=$1 AND element_id=$2 AND author_uuid=$3`,
			cardID, elementID, body.AuthorUUID)
		err = e
		if err == nil {
			n, _ = res.RowsAffected()
		}
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if n == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权删除或卡片不存在"})
		return
	}

	msgBytes, _ := json.Marshal(map[string]interface{}{
		"type": ws.MsgShelfCardDelete,
		"data": map[string]interface{}{
			"element_id": elementID,
			"card_id":    cardID,
		},
	})
	if room := h.hub.GetRoom(roomID); room != nil {
		room.BroadcastRaw(msgBytes)
	}

	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

func (h *ShelfHandler) ToggleShelfVisibility(c *gin.Context) {
	roomID := c.Param("id")
	elementID := c.Param("eid")

	var body struct {
		Visibility string `json:"visibility"`
	}
	if err := c.ShouldBindJSON(&body); err != nil ||
		(body.Visibility != "isolated" && body.Visibility != "open") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "visibility 须为 isolated 或 open"})
		return
	}

	msgBytes, _ := json.Marshal(map[string]interface{}{
		"type": ws.MsgShelfVisibility,
		"data": map[string]interface{}{
			"element_id": elementID,
			"visibility": body.Visibility,
		},
	})
	if room := h.hub.GetRoom(roomID); room != nil {
		room.BroadcastRaw(msgBytes)
	}

	c.JSON(http.StatusOK, gin.H{"visibility": body.Visibility})
}
