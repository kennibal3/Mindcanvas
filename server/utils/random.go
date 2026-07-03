// =============================================================
// MindCanvas v3.0 - 随机数工具模块
// 功能：生成各类随机码（防冒充后缀/邀请码/认领码/UUID）
// =============================================================
package utils

import (
	"fmt"
	"math/rand"
	"time"

	"github.com/google/uuid"
)

// init 初始化随机数种子
func init() {
	rand.Seed(time.Now().UnixNano())
}

// GenerateUUID 生成标准 UUID v4
func GenerateUUID() string {
	return uuid.New().String()
}

// GenerateGuestUUID 生成学生用 UUID（带 guest- 前缀）
func GenerateGuestUUID() string {
	return fmt.Sprintf("guest-%s", uuid.New().String())
}

// GenerateSuffix 生成 4 位数字防冒充后缀
// 范围：1000-9999，确保始终是 4 位
func GenerateSuffix() string {
	return fmt.Sprintf("%04d", rand.Intn(9000)+1000)
}

// GenerateInviteCode 生成 6 位房间邀请码
// 字符集：大写字母 + 数字（去除易混淆字符 O/0/I/1/L）
func GenerateInviteCode() string {
	const charset = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	code := make([]byte, 6)
	for i := range code {
		code[i] = charset[rand.Intn(len(charset))]
	}
	return string(code)
}

// GenerateReclaimCode 生成 4 位设备认领码（纯数字）
func GenerateReclaimCode() string {
	return fmt.Sprintf("%04d", rand.Intn(10000))
}
