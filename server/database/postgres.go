// =============================================================
// MindCanvas v3.0 - PostgreSQL 数据库连接模块
// 功能：建立连接池、健康检查、连接参数配置
// 使用 database/sql + lib/pq 驱动（参数化查询防注入）
// =============================================================
package database

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/lib/pq" // PostgreSQL 驱动

	"mindcanvas-server/config"
)

// 全局数据库连接实例
var db *sql.DB

// InitPostgres 初始化 PostgreSQL 连接
// 参数：cfg - 数据库配置
// 返回：*sql.DB 连接实例和错误
func InitPostgres(cfg config.DBConfig) (*sql.DB, error) {
	// 构建 DSN 连接字符串
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.Name, cfg.SSLMode,
	)

	// 打开数据库连接
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("数据库连接失败: %w", err)
	}

	// 配置连接池参数
	db.SetMaxOpenConns(cfg.MaxOpenConns)    // 最大打开连接数
	db.SetMaxIdleConns(cfg.MaxIdleConns)    // 最大空闲连接数
	db.SetConnMaxLifetime(cfg.ConnMaxLifetime) // 连接最大生命周期

	// 健康检查：验证连接是否可用
	if err = db.Ping(); err != nil {
		return nil, fmt.Errorf("数据库 Ping 失败: %w", err)
	}

	log.Printf("[数据库] PostgreSQL 连接成功 - %s:%s/%s (最大连接:%d)",
		cfg.Host, cfg.Port, cfg.Name, cfg.MaxOpenConns)

	return db, nil
}

// GetDB 获取全局数据库连接实例
func GetDB() *sql.DB {
	return db
}

// Close 关闭数据库连接（优雅关闭时调用）
func Close() {
	if db != nil {
		if err := db.Close(); err != nil {
			log.Printf("[数据库] 关闭连接出错: %v", err)
		} else {
			log.Println("[数据库] 连接已关闭")
		}
	}
}
