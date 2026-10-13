package services

import (
	"testing"

	"mindcanvas-server/models"
)

// BUG-055：通用码全班共用，绝不能绑定到某一个学生的提交上，
// 否则后来的学生会被认成第一个学生（看到并覆盖别人的作业）。
func TestTokenBindsSubmissionOnlyForDedicated(t *testing.T) {
	if tokenBindsSubmission(models.TokenTypeUniversal) {
		t.Error("通用码不应绑定提交")
	}
	if !tokenBindsSubmission(models.TokenTypeDedicated) {
		t.Error("专属码应继续绑定提交（BUG-013 依赖它）")
	}
}
