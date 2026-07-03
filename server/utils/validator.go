// =============================================================
// MindCanvas v3.0 - 参数校验工具模块
// 功能：统一的输入校验函数
// =============================================================
package utils

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// 校验用正则表达式
var (
	// 用户名：3-30位，字母数字下划线
	usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_]{3,30}$`)
	// 密码：至少8位，包含字母和数字
	passwordRegex = regexp.MustCompile(`^.{8,50}$`)
)

// ValidateNickname 校验学生昵称
// 规则：2-20 个字符（按 UTF-8 字符数计算，支持中文）
func ValidateNickname(nickname string) error {
	nickname = strings.TrimSpace(nickname)
	length := utf8.RuneCountInString(nickname)
	if length < 2 {
		return fmt.Errorf("昵称至少需要 2 个字符")
	}
	if length > 20 {
		return fmt.Errorf("昵称不能超过 20 个字符")
	}
	return nil
}

// ValidateUsername 校验登录用户名
// 规则：3-30 位，仅允许字母、数字、下划线
func ValidateUsername(username string) error {
	if !usernameRegex.MatchString(username) {
		return fmt.Errorf("用户名须为 3-30 位字母、数字或下划线")
	}
	return nil
}

// ValidatePassword 校验密码
// 规则：8-50 位
func ValidatePassword(password string) error {
	if !passwordRegex.MatchString(password) {
		return fmt.Errorf("密码须为 8-50 位")
	}
	return nil
}

// ValidateRoomTitle 校验房间标题
// 规则：1-100 个字符
func ValidateRoomTitle(title string) error {
	title = strings.TrimSpace(title)
	length := utf8.RuneCountInString(title)
	if length < 1 {
		return fmt.Errorf("房间标题不能为空")
	}
	if length > 100 {
		return fmt.Errorf("房间标题不能超过 100 个字符")
	}
	return nil
}

// ValidateRole 校验用户角色值
func ValidateRole(role string) error {
	switch role {
	case "superadmin", "admin", "teacher":
		return nil
	default:
		return fmt.Errorf("无效的角色: %s（允许值: superadmin/admin/teacher）", role)
	}
}

// ValidateMaxCapacity 校验房间最大容量
// 范围：1-200
func ValidateMaxCapacity(capacity int) error {
	if capacity < 1 || capacity > 200 {
		return fmt.Errorf("房间容量须在 1-200 之间")
	}
	return nil
}

// SanitizeString 清理字符串（去除首尾空白，防 XSS）
func SanitizeString(s string) string {
	s = strings.TrimSpace(s)
	// 替换 HTML 特殊字符，防止 XSS
	replacer := strings.NewReplacer(
		"<", "&lt;",
		">", "&gt;",
		"\"", "&quot;",
		"'", "&#39;",
		"&", "&amp;",
	)
	return replacer.Replace(s)
}
