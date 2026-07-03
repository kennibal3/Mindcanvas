// =============================================================
// MindCanvas v3.0 - Redis 连接模块
// 功能：初始化 Redis 客户端，用于会话/黑名单/认领码/快照缓存
// =============================================================
package database

import (
	"context"
	"fmt"
	"log"

	"github.com/redis/go-redis/v9"

	"mindcanvas-server/config"
)

// 全局 Redis 客户端实例
var rdb *redis.Client

// InitRedis 初始化 Redis 连接
func InitRedis(cfg config.RedisConfig) (*redis.Client, error) {
	rdb = redis.NewClient(&redis.Options{
		Addr:     cfg.Addr,     // Redis 地址
		Password: cfg.Password, // 密码（无密码为空字符串）
		DB:       cfg.DB,       // 数据库编号
		PoolSize: 10,           // 连接池大小（小内存服务器控制在10）
	})

	// 健康检查
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("Redis 连接失败: %w", err)
	}

	log.Printf("[Redis] 连接成功 - %s DB:%d", cfg.Addr, cfg.DB)

	return rdb, nil
}

// GetRedis 获取全局 Redis 客户端
func GetRedis() *redis.Client {
	return rdb
}

// CloseRedis 关闭 Redis 连接
func CloseRedis() {
	if rdb != nil {
		if err := rdb.Close(); err != nil {
			log.Printf("[Redis] 关闭连接出错: %v", err)
		} else {
			log.Println("[Redis] 连接已关闭")
		}
	}
}
