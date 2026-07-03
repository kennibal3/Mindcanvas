// =============================================================
// MindCanvas v3.0 - 配置加载模块
// 功能：从 .env 文件和环境变量加载系统配置
// 优先级：环境变量 > .env 文件 > 默认值
// =============================================================
package config

import (
	"log"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

// Config 全局配置结构体
type Config struct {
	Server    ServerConfig    // 服务端配置
	DB        DBConfig        // 数据库配置
	Redis     RedisConfig     // Redis 配置
	JWT       JWTConfig       // JWT 认证配置
	OSS       OSSConfig       // 对象存储配置
	CORS      CORSConfig      // 跨域配置
	Profanity ProfanityConfig // 敏感词配置
	AI        AIConfig        // AI 服务配置
}

// ServerConfig 服务端配置
type ServerConfig struct {
	Port    string // 服务监听端口
	GinMode string // Gin 运行模式：debug/release
}

// DBConfig PostgreSQL 数据库配置
type DBConfig struct {
	Host            string        // 数据库主机地址
	Port            string        // 数据库端口
	Name            string        // 数据库名称
	User            string        // 数据库用户
	Password        string        // 数据库密码
	SSLMode         string        // SSL 模式
	MaxOpenConns    int           // 最大打开连接数
	MaxIdleConns    int           // 最大空闲连接数
	ConnMaxLifetime time.Duration // 连接最大生命周期
}

// RedisConfig Redis 缓存配置
type RedisConfig struct {
	Addr     string // Redis 地址 host:port
	Password string // Redis 密码（无密码为空）
	DB       int    // Redis 数据库编号
}

// JWTConfig JWT 认证配置
type JWTConfig struct {
	Secret       string        // JWT 签名密钥
	Expire       time.Duration // Token 过期时间
	CookieName   string        // Cookie 名称
	CookieSecure bool          // Cookie Secure 标志（HTTPS 时为 true）
	CookieDomain string        // Cookie 域名
}

// OSSConfig 对象存储配置
type OSSConfig struct {
	Endpoint   string // OSS 端点
	AccessKey  string // 访问密钥 ID
	SecretKey  string // 访问密钥 Secret
	Bucket     string // 存储桶名称
	STSRoleARN string // STS 角色 ARN（直传用）
}

// CORSConfig 跨域配置
type CORSConfig struct {
	Origins string // 允许的源，逗号分隔
}

// ProfanityConfig 敏感词配置
type ProfanityConfig struct {
	DictPath string // 敏感词词库文件路径
}

// AIConfig AI 服务配置
type AIConfig struct {
        APIKey  string // ARK_API_KEY
        BaseURL string // ARK_BASE_URL
        Model   string // ARK_MODEL
}

// 全局配置实例
var globalConfig *Config

// Load 加载配置
// 从指定路径的 .env 文件读取，环境变量可覆盖
func Load(envPath string) *Config {
	// 尝试加载 .env 文件（不存在也不报错，允许纯环境变量模式）
	if err := godotenv.Load(envPath); err != nil {
		log.Printf("[配置] .env 文件未找到(%s)，使用环境变量", envPath)
	}

	// 解析 JWT 过期时间
	jwtExpire, err := time.ParseDuration(getEnv("JWT_EXPIRE", "24h"))
	if err != nil {
		jwtExpire = 24 * time.Hour
	}

	// 解析连接最大生命周期
	connLifetime := time.Duration(getEnvInt("DB_CONN_MAX_LIFETIME", 300)) * time.Second

	globalConfig = &Config{
		Server: ServerConfig{
			Port:    getEnv("PORT", "8080"),
			GinMode: getEnv("GIN_MODE", "debug"),
		},
		DB: DBConfig{
			Host:            getEnv("DB_HOST", "localhost"),
			Port:            getEnv("DB_PORT", "5432"),
			Name:            getEnv("DB_NAME", "mindcanvas"),
			User:            getEnv("DB_USER", "mindcanvas"),
			Password:        getEnv("DB_PASSWORD", ""),
			SSLMode:         getEnv("DB_SSLMODE", "disable"),
			MaxOpenConns:    getEnvInt("DB_MAX_OPEN_CONNS", 25),
			MaxIdleConns:    getEnvInt("DB_MAX_IDLE_CONNS", 5),
			ConnMaxLifetime: connLifetime,
		},
		Redis: RedisConfig{
			Addr:     getEnv("REDIS_ADDR", "localhost:6379"),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       getEnvInt("REDIS_DB", 0),
		},
		JWT: JWTConfig{
			Secret:       getEnv("JWT_SECRET", ""),
			Expire:       jwtExpire,
			CookieName:   getEnv("JWT_COOKIE_NAME", "mc_token"),
			CookieSecure: getEnvBool("JWT_COOKIE_SECURE", false),
			CookieDomain: getEnv("JWT_COOKIE_DOMAIN", ""),
		},
		OSS: OSSConfig{
			Endpoint:   getEnv("OSS_ENDPOINT", ""),
			AccessKey:  getEnv("OSS_ACCESS_KEY", ""),
			SecretKey:  getEnv("OSS_SECRET_KEY", ""),
			Bucket:     getEnv("OSS_BUCKET", "mindcanvas-media"),
			STSRoleARN: getEnv("OSS_STS_ROLE_ARN", ""),
		},
		CORS: CORSConfig{
			Origins: getEnv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173"),
		},
		Profanity: ProfanityConfig{
			DictPath: getEnv("PROFANITY_DICT_PATH", "/opt/mindcanvas/configs/profanity_words.txt"),
		},
	}

	globalConfig.AI = AIConfig{
		APIKey:  getEnv("ARK_API_KEY", ""),
		BaseURL: getEnv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"),
		Model:   getEnv("ARK_MODEL", "doubao-seed-2-1-turbo-260628"),
	}
	// 校验必填配置
	if globalConfig.JWT.Secret == "" {
		log.Fatal("[配置] JWT_SECRET 未设置，服务无法启动")
	}
	if globalConfig.DB.Password == "" {
		log.Fatal("[配置] DB_PASSWORD 未设置，服务无法启动")
	}

	log.Printf("[配置] 加载完成 - 端口:%s 数据库:%s@%s:%s/%s Redis:%s",
		globalConfig.Server.Port,
		globalConfig.DB.User, globalConfig.DB.Host, globalConfig.DB.Port, globalConfig.DB.Name,
		globalConfig.Redis.Addr,
	)

	return globalConfig
}

// Get 获取全局配置（需先调用 Load）
func Get() *Config {
	if globalConfig == nil {
		log.Fatal("[配置] 配置未加载，请先调用 config.Load()")
	}
	return globalConfig
}

// getEnv 获取环境变量，不存在则返回默认值
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvInt 获取整数类型环境变量
func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}

// getEnvBool 获取布尔类型环境变量
func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolVal, err := strconv.ParseBool(value); err == nil {
			return boolVal
		}
	}
	return defaultValue
}
