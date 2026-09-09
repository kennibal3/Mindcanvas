#!/bin/bash
# ============================================================
# MindCanvas 异地副本拉取脚本(REQ-053,2026-09-09)
# 运行位置:异地机器(如用户的 Mac)的正常终端环境,不是服务器,
#          也不是 Cowork 会话里那种隔离 VM——配合 macOS launchd 定时任务使用,
#          见同目录 com.mindcanvas.offsitepull.plist.example
# 作用:定时从服务器的"待取件目录"把已加密的备份文件拉回本地。
#      服务器那侧只负责加密+暂存,不主动往外连,靠这个脚本主动去取——
#      服务器公网 IP 固定、常年在线,被动等待连接的一方换成服务器更稳,
#      不需要 Mac 有公网可达地址。
# ============================================================

set -Eeuo pipefail

# ----- 配置区 -----
SERVER_HOST="47.83.246.106"
SERVER_USER="root"
SERVER_PORT=22
SERVER_STAGING_DIR="/var/backups/mindcanvas/offsite_pending"

LOCAL_DEST_DIR="${HOME}/MindCanvas备份/异地"
LOCAL_RETAIN_DAYS=90   # 本地留存策略,先与服务器周归档对齐,按需自行调整
LOG_FILE="${HOME}/MindCanvas备份/pull_offsite.log"
# ----- 配置区结束 -----

mkdir -p "${LOCAL_DEST_DIR}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"
}

log "========== 异地副本拉取开始 =========="

# -a 归档模式(保留权限/时间戳) -z 压缩传输
# --ignore-existing:已经拉过的文件不重复传,可以每天重复跑、不会覆盖/重传
# BatchMode=yes:免密登录没配好会直接失败退出,不会卡在等密码输入
if rsync -az --ignore-existing \
    -e "ssh -p ${SERVER_PORT} -o ConnectTimeout=10 -o BatchMode=yes" \
    "${SERVER_USER}@${SERVER_HOST}:${SERVER_STAGING_DIR}/" "${LOCAL_DEST_DIR}/"; then
    log "✅ 拉取完成,当前本地文件数: $(find "${LOCAL_DEST_DIR}" -name '*.enc' -type f | wc -l | tr -d ' ')"
else
    log "❌ 拉取失败——检查服务器是否在线、SSH 免密登录是否配置好(见脚本头部注释)"
    exit 1
fi

# 清理本地超过留存期的旧文件
DELETED=$(find "${LOCAL_DEST_DIR}" -name "*.enc" -type f -mtime "+${LOCAL_RETAIN_DAYS}" -print -delete | wc -l | tr -d ' ')
log "🧹 清理本地超过 ${LOCAL_RETAIN_DAYS} 天的旧异地副本: ${DELETED} 个"

log "========== 异地副本拉取结束 =========="
echo ""
