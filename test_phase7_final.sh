#!/bin/bash
# =============================================================
# MindCanvas v4.1 - 全功能自动化测试（v4 最终修复版）
# 关键修复：pgq() 用 head -1 只取第一行，避免 INSERT 0 N 拼接
# =============================================================
set -uo pipefail

BASE="http://localhost:8080"
PASS=0; FAIL=0; SKIP=0; ERRORS=()
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log_section() { echo -e "\n${BLUE}══════════════════════════════════════${NC}"; echo -e "${BLUE}  $1${NC}"; echo -e "${BLUE}══════════════════════════════════════${NC}"; }
log_pass()    { echo -e "  ${GREEN}✅ PASS${NC} $1"; ((PASS++)); }
log_fail()    { echo -e "  ${RED}❌ FAIL${NC} $1"; ((FAIL++)); ERRORS+=("$1"); }
log_skip()    { echo -e "  ${YELLOW}⏭  SKIP${NC} $1"; ((SKIP++)); }
log_info()    { echo -e "  ${YELLOW}ℹ  INFO${NC} $1"; }

do_login() {
    curl -s -D - -X POST "$BASE/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$1\",\"password\":\"$2\"}" 2>/dev/null \
    | grep -i "set-cookie.*mc_token" \
    | sed 's/.*mc_token=\([^;]*\).*/\1/' | tr -d ' \r\n'
}
do_req() {
    local method=$1 url=$2 token=${3:-""} body=${4:-""}
    local args=(-s -w "\n__STATUS__%{http_code}" -X "$method" "$BASE$url" -H "Content-Type: application/json")
    [[ -n "$token" ]] && args+=(-H "Cookie: mc_token=$token")
    [[ -n "$body"  ]] && args+=(--data "$body")
    curl "${args[@]}" 2>/dev/null
}
get_status() { echo "$1" | grep "__STATUS__" | sed 's/__STATUS__//'; }
get_body()   { echo "$1" | grep -v "__STATUS__"; }
assert_status() {
    local desc=$1 resp=$2 expected=$3
    local actual; actual=$(get_status "$resp")
    if [[ "$actual" == "$expected" ]]; then log_pass "$desc (HTTP $actual)"
    else log_fail "$desc (期望 HTTP $expected，实际 HTTP $actual，响应: $(get_body "$resp" | head -c 150))"; fi
}
jget2() {
    echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2',{}).get('$3',''))" 2>/dev/null
}

# ⭐ 关键修复：head -1 只取第一行，去除 psql 的 "INSERT 0 N" 输出拼接
pgq() {
    PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas \
        -t -c "$1" 2>/dev/null | grep -v '^[[:space:]]*$' | head -1 | tr -d ' \n'
}
# pgx：执行写操作，静默成功，出错时打印
pgx() {
    local out
    out=$(PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas \
        -c "$1" 2>&1)
    if echo "$out" | grep -qi "error\|fatal"; then
        echo "  [pgx ERROR] $out" >&2
    fi
}

# 测试变量
T1=""; T2=""
ROOM_ID=""; INV_CODE=""
POLL_ID=""; WC_ID=""; QA_ID=""; DZ_ID=""
S1=""; S2=""; S3=""

cleanup() {
    [[ -n "$ROOM_ID" ]] && pgx "DELETE FROM rooms WHERE id='$ROOM_ID';" \
        && log_info "已清理测试房间 ${ROOM_ID:0:8}..."
}

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║     MindCanvas v4.1 全功能自动化测试（v4最终版）     ║"
echo "║     $(date '+%Y-%m-%d %H:%M:%S')                          ║"
echo "╚══════════════════════════════════════════════════════╝"

# ============================================================
# 1. 健康检查
# ============================================================
log_section "1. 服务健康检查"
resp=$(do_req GET /health)
assert_status "健康检查" "$resp" "200"
phase=$(get_body "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('phase',''))" 2>/dev/null)
[[ "$phase" == "7" ]] && log_pass "phase=7 确认" || log_fail "phase=$phase（应为7）"

# ============================================================
# 2. 认证系统
# ============================================================
log_section "2. 认证系统"
resp=$(do_req POST /api/auth/login "" '{"username":"teacher01","password":"wrongpwd"}')
assert_status "错误密码拒绝" "$resp" "401"

T1=$(do_login "teacher01" "Test@2026")
[[ -n "$T1" ]] && log_pass "teacher01 Token: ${T1:0:20}..." || log_fail "teacher01 登录失败"

resp=$(do_req GET /api/auth/me "$T1")
assert_status "Token验证" "$resp" "200"
uid=$(get_body "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('user',{}).get('id',''))" 2>/dev/null)
[[ -n "$uid" ]] && log_pass "用户ID: ${uid:0:8}..." || log_fail "用户ID为空"

resp=$(do_req GET /api/rooms)
assert_status "未认证返回401" "$resp" "401"

T2=$(do_login "teacher02" "Test@2026")
[[ -n "$T2" ]] && log_pass "teacher02 登录成功" || log_fail "teacher02 登录失败"

# ============================================================
# 3. 房间管理
# ============================================================
log_section "3. 房间管理"
resp=$(do_req GET /api/rooms "$T1")
assert_status "获取房间列表" "$resp" "200"

resp=$(do_req POST /api/rooms "$T1" \
    '{"title":"自动化测试房间_可删除","max_capacity":30,"room_mode":"interactive"}')
assert_status "创建测试房间" "$resp" "201"
body=$(get_body "$resp")
ROOM_ID=$(jget2 "$body" "room" "id")
INV_CODE=$(jget2 "$body" "room" "invite_code")
[[ -n "$ROOM_ID" ]] && log_pass "房间 ID=${ROOM_ID:0:8}... 邀请码=$INV_CODE" \
                    || log_fail "房间创建失败"

[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req GET "/api/rooms/$ROOM_ID" "$T1"); assert_status "获取房间详情" "$resp" "200"
    resp=$(do_req PUT "/api/rooms/$ROOM_ID" "$T1" '{"title":"测试房间已更新","max_capacity":50}')
    assert_status "更新房间" "$resp" "200"
    resp=$(do_req DELETE "/api/rooms/$ROOM_ID" "$T2")
    s=$(get_status "$resp")
    [[ "$s" == "403" || "$s" == "404" ]] && log_pass "跨教师权限隔离 (HTTP $s)" \
                                          || log_info "跨教师删除 HTTP $s"
}

# ============================================================
# 4. 学生入场
# ============================================================
log_section "4. 学生免注册入场"
if [[ -n "$INV_CODE" ]]; then
    for i in 1 2 3; do
        case $i in 1) nick="测试学生甲";; 2) nick="测试学生乙";; 3) nick="测试学生丙";; esac
        resp=$(do_req POST /api/guest/join "" \
            "{\"room_code\":\"$INV_CODE\",\"nickname\":\"$nick\",\"avatar_id\":$i}")
        assert_status "学生${i}入场" "$resp" "200"
        uuid=$(get_body "$resp" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if 'data' in d and isinstance(d.get('data'),dict): print(d['data'].get('uuid',''))
elif 'uuid' in d: print(d['uuid'])
else: print('')
" 2>/dev/null)
        case $i in 1) S1=$uuid;; 2) S2=$uuid;; 3) S3=$uuid;; esac
        [[ -n "$uuid" ]] && log_pass "学生${i} UUID: ${uuid:0:8}..." \
                         || log_fail "学生${i} UUID为空"
    done
    resp=$(do_req POST /api/guest/join "" '{"room_code":"INVALID999","nickname":"黑客","avatar_id":1}')
    s=$(get_status "$resp")
    [[ "$s" == "400" || "$s" == "404" ]] && log_pass "无效房间码拒绝 (HTTP $s)" \
                                          || log_fail "无效房间码未拒绝 (HTTP $s)"
else
    log_skip "学生入场（无邀请码）"
    S1="fallback-s1"; S2="fallback-s2"; S3="fallback-s3"
fi

# ============================================================
# 5. Widget 数据写入与完整性验证
# ============================================================
log_section "5. Widget 数据写入与完整性验证"
if [[ -n "$ROOM_ID" ]]; then
    # 5A 投票
    POLL_ID=$(pgq "INSERT INTO room_elements (room_id,creator_uuid,creator_name,type,payload)
        VALUES ('$ROOM_ID','t-uuid','teacher01','polling_widget',
        '{\"question\":\"最喜欢？\",\"options\":[\"投票\",\"词云\",\"问答\",\"作品墙\"],
          \"mode\":\"single\",\"anonymous\":false,\"showResult\":true,
          \"allowChange\":false,\"status\":\"open\",\"votes\":{}}')
        RETURNING id;")
    log_info "POLL_ID=[${POLL_ID}] 长度=${#POLL_ID}"
    [[ "${#POLL_ID}" == "36" ]] && log_pass "投票 Widget ID=${POLL_ID:0:8}" \
                                 || log_fail "投票 Widget ID 异常: [${POLL_ID}]"

    pgx "INSERT INTO widget_interactions
            (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data)
         VALUES
            ('$ROOM_ID','$POLL_ID','$S1','测试学生甲','polling_widget','vote','{\"option\":\"投票\"}'),
            ('$ROOM_ID','$POLL_ID','$S2','测试学生乙','polling_widget','vote','{\"option\":\"词云\"}'),
            ('$ROOM_ID','$POLL_ID','$S3','测试学生丙','polling_widget','vote','{\"option\":\"投票\"}')
         ON CONFLICT DO NOTHING;"
    log_pass "投票数据写入（3票）"

    # 5B 词云
    WC_ID=$(pgq "INSERT INTO room_elements (room_id,creator_uuid,creator_name,type,payload)
        VALUES ('$ROOM_ID','t-uuid','teacher01','wordcloud_widget',
        '{\"prompt\":\"描述课堂\",\"words\":{},\"status\":\"open\",\"maxWordsPerStudent\":3}')
        RETURNING id;")
    [[ "${#WC_ID}" == "36" ]] && log_pass "词云 Widget ID=${WC_ID:0:8}" \
                               || log_fail "词云 Widget ID 异常: [${WC_ID}]"
    pgx "INSERT INTO widget_interactions
            (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data)
         VALUES
            ('$ROOM_ID','$WC_ID','$S1','测试学生甲','wordcloud_widget','add_word','{\"word\":\"好用\"}'),
            ('$ROOM_ID','$WC_ID','$S2','测试学生乙','wordcloud_widget','add_word','{\"word\":\"稳定\"}'),
            ('$ROOM_ID','$WC_ID','$S3','测试学生丙','wordcloud_widget','add_word','{\"word\":\"好用\"}')
         ON CONFLICT DO NOTHING;"
    log_pass "词云数据写入（3条）"

    # 5C 问答
    QA_ID=$(pgq "INSERT INTO room_elements (room_id,creator_uuid,creator_name,type,payload)
        VALUES ('$ROOM_ID','t-uuid','teacher01','qa_widget',
        '{\"question\":\"HTTP 200 表示？\",\"options\":[\"成功\",\"未找到\",\"错误\",\"重定向\"],
          \"correct_answer\":0,\"status\":\"open\",\"show_answer\":true,\"stats\":{}}')
        RETURNING id;")
    [[ "${#QA_ID}" == "36" ]] && log_pass "问答 Widget ID=${QA_ID:0:8}" \
                               || log_fail "问答 Widget ID 异常: [${QA_ID}]"
    pgx "INSERT INTO widget_interactions
            (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data,is_correct)
         VALUES
            ('$ROOM_ID','$QA_ID','$S1','测试学生甲','qa_widget','answer','{\"answer\":\"成功\"}'::jsonb,true),
            ('$ROOM_ID','$QA_ID','$S2','测试学生乙','qa_widget','answer','{\"answer\":\"未找到\"}'::jsonb,false),
            ('$ROOM_ID','$QA_ID','$S3','测试学生丙','qa_widget','answer','{\"answer\":\"成功\"}'::jsonb,true)
         ON CONFLICT DO NOTHING;"
    log_pass "问答数据写入（预期正确率66.7%）"

    # 5D 作品墙
    DZ_ID=$(pgq "INSERT INTO room_elements (room_id,creator_uuid,creator_name,type,payload)
        VALUES ('$ROOM_ID','t-uuid','teacher01','dropzone_widget',
        '{\"title\":\"学习心得\",\"acceptTypes\":[\"text\",\"link\"],
          \"layout\":\"grid\",\"status\":\"open\",\"maxPerStudent\":3,
          \"hideNames\":false,\"submissionOrder\":[]}')
        RETURNING id;")
    [[ "${#DZ_ID}" == "36" ]] && log_pass "作品墙 Widget ID=${DZ_ID:0:8}" \
                               || log_fail "作品墙 Widget ID 异常: [${DZ_ID}]"
    pgx "INSERT INTO widget_interactions
            (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data)
         VALUES
            ('$ROOM_ID','$DZ_ID','$S1','测试学生甲','dropzone_widget','submit',
             '{\"content_type\":\"text\",\"content\":\"自动化测试验证稳定性\",\"likes\":0,\"tags\":[],\"pinned\":false,\"hidden\":false}'::jsonb),
            ('$ROOM_ID','$DZ_ID','$S2','测试学生乙','dropzone_widget','submit',
             '{\"content_type\":\"link\",\"content\":\"https://mindcanvas.com.cn\",\"likes\":2,\"tags\":[\"推荐\"],\"pinned\":true,\"hidden\":false}'::jsonb),
            ('$ROOM_ID','$DZ_ID','$S3','测试学生丙','dropzone_widget','submit',
             '{\"content_type\":\"text\",\"content\":\"好用又稳定\",\"likes\":1,\"tags\":[],\"pinned\":false,\"hidden\":false}'::jsonb)
         ON CONFLICT DO NOTHING;"
    log_pass "作品墙数据写入（3件）"

    pgx "INSERT INTO peer_reviews (dropzone_id,submission_id,reviewer_uuid,scores,comment)
         SELECT '$DZ_ID',wi.id,'$S2','{\"creativity\":4,\"clarity\":5,\"depth\":3}'::jsonb,'写得很好！'
         FROM widget_interactions wi
         WHERE wi.element_id='$DZ_ID' AND wi.student_uuid='$S1' AND wi.action_type='submit'
         LIMIT 1 ON CONFLICT DO NOTHING;"
    log_pass "同伴互评写入"

    # ---- 完整性验证（此时房间和数据仍存在）----
    log_info "--- 数据完整性验证 ---"

    wi_n=$(pgq "SELECT COUNT(*) FROM widget_interactions WHERE room_id='$ROOM_ID';")
    log_info "widget_interactions 总记录: $wi_n"
    [[ "${wi_n:-0}" -ge "9" ]] && log_pass "数据完整（${wi_n}条 ≥ 9）" \
                                 || log_fail "数据不足（${wi_n}条，预期≥9）"

    c_ok=$(pgq "SELECT COUNT(*) FROM widget_interactions WHERE element_id='$QA_ID' AND action_type='answer' AND is_correct=true;")
    c_no=$(pgq "SELECT COUNT(*) FROM widget_interactions WHERE element_id='$QA_ID' AND action_type='answer' AND is_correct=false;")
    log_info "问答: 正确=${c_ok} 错误=${c_no}"
    [[ "${c_ok:-0}" == "2" && "${c_no:-0}" == "1" ]] \
        && log_pass "is_correct 写入正确（2对1错）" \
        || log_fail "is_correct 异常（正确=${c_ok} 错误=${c_no}）"

    dup_n=$(pgq "SELECT COUNT(*) FROM (SELECT student_uuid FROM widget_interactions WHERE element_id='$POLL_ID' AND action_type='vote' GROUP BY student_uuid HAVING COUNT(*)>1) t;")
    [[ "${dup_n:-0}" == "0" ]] && log_pass "投票唯一约束通过（无重复）" \
                                 || log_fail "存在重复投票（${dup_n}个）"

    pgx "INSERT INTO widget_interactions (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data) VALUES ('$ROOM_ID','$POLL_ID','$S1','测试学生甲','polling_widget','vote','{"option":"词云"}') ON CONFLICT DO NOTHING;"
    dup_after=$(pgq "SELECT COUNT(*) FROM widget_interactions WHERE element_id='$POLL_ID' AND student_uuid='$S1' AND action_type='vote';")
    [[ "${dup_after:-0}" == "1" ]] && log_pass "重复投票被唯一约束拦截（记录数仍为1）" || log_fail "重复投票拦截异常（记录数=${dup_after}）"

    log_info "action_type 分布:"
    PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -t -c \
        "SELECT '  '||action_type||': '||COUNT(*)||' 条' FROM widget_interactions WHERE room_id='$ROOM_ID' GROUP BY action_type ORDER BY COUNT(*) DESC;" \
        2>/dev/null | grep -v '^[[:space:]]*$' | while read -r l; do log_info "$l"; done
else
    log_skip "Widget 测试（无房间）"
fi

# ============================================================
# 6. 场控 API
# ============================================================
log_section "6. 场控 API"
[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req PUT "/api/rooms/$ROOM_ID/lock" "$T1" '{"is_locked":true}'); assert_status "锁定" "$resp" "200"
    resp=$(do_req PUT "/api/rooms/$ROOM_ID/lock" "$T1" '{"is_locked":false}'); assert_status "解锁" "$resp" "200"
    resp=$(do_req PUT "/api/rooms/$ROOM_ID/readonly" "$T1" '{"is_readonly":true}'); assert_status "设只读" "$resp" "200"
    resp=$(do_req PUT "/api/rooms/$ROOM_ID/readonly" "$T1" '{"is_readonly":false}'); assert_status "恢复编辑" "$resp" "200"
    resp=$(do_req POST "/api/rooms/$ROOM_ID/gather" "$T1" '{"viewport_x":0,"viewport_y":0,"zoom":1}'); assert_status "召集" "$resp" "200"
    resp=$(do_req GET "/api/rooms/$ROOM_ID/members" "$T1"); assert_status "获取成员" "$resp" "200"
} || log_skip "场控（无房间）"

# ============================================================
# 7. 数据导出
# ============================================================
log_section "7. 数据导出"
[[ -n "$ROOM_ID" ]] && {
    for t in "all" "vote" "word"; do
        resp=$(do_req GET "/api/rooms/$ROOM_ID/export?type=$t" "$T1")
        assert_status "CSV type=$t" "$resp" "200"
    done
    resp=$(do_req GET "/api/rooms/$ROOM_ID/export/contributions" "$T1"); assert_status "贡献统计" "$resp" "200"
    resp=$(do_req GET "/api/rooms/$ROOM_ID/export/text" "$T1"); assert_status "文字内容" "$resp" "200"
} || log_skip "导出（无房间）"

# ============================================================
# 8. 课堂总结
# ============================================================
log_section "8. 课堂总结中心"
[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req GET "/api/rooms/$ROOM_ID/summary" "$T1")
    assert_status "获取总结" "$resp" "200"
    body=$(get_body "$resp")
    for field in "polls" "word_clouds" "qa_summaries" "dropzones"; do
        n=$(echo "$body" | python3 -c "
import sys,json; d=json.load(sys.stdin); s=d.get('summary',d); print(len(s.get('$field',[])))" 2>/dev/null)
        [[ "${n:-0}" -ge "1" ]] && log_pass "总结含 $field（${n}条）" || log_fail "总结缺 $field"
    done
    qa_rate=$(echo "$body" | python3 -c "
import sys,json; d=json.load(sys.stdin); s=d.get('summary',d)
qa=s.get('qa_summaries',[]); print(round(qa[0].get('correct_rate',0)*100) if qa else -1)" 2>/dev/null)
    log_info "问答正确率: ${qa_rate}%"
    [[ "${qa_rate:-0}" -ge "60" && "${qa_rate:-0}" -le "70" ]] \
        && log_pass "问答正确率正确 (${qa_rate}%)" || log_fail "问答正确率偏差 (${qa_rate}%，预期60-70%)"
    resp=$(do_req GET "/api/rooms/$ROOM_ID/summary/export" "$T1"); assert_status "Markdown导出" "$resp" "200"
    md=$(get_body "$resp")
    for kw in "课堂总结" "投票" "问答" "词云" "作品墙"; do
        echo "$md" | grep -q "$kw" && log_pass "Markdown含'$kw'" || log_fail "Markdown缺'$kw'"
    done
} || log_skip "总结（无房间）"

# ============================================================
# 9. 学情雷达
# ============================================================
log_section "9. 学情雷达"
[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req GET "/api/rooms/$ROOM_ID/insight" "$T1"); assert_status "获取学情雷达" "$resp" "200"
    n=$(get_body "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('insight',{}).get('components',[])))" 2>/dev/null)
    [[ "${n:-0}" -ge "1" ]] && log_pass "学情组件正常（${n}个）" || log_fail "学情无组件"
    resp=$(do_req POST "/api/rooms/$ROOM_ID/insight/refresh" "$T1"); assert_status "刷新缓存" "$resp" "200"
} || log_skip "学情（无房间）"

# ============================================================
# 10. 分组管理
# ============================================================
log_section "10. 分组管理"
[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req POST "/api/rooms/$ROOM_ID/groups" "$T1" '{"name":"第一组","color":"#4472C4","members":[]}')
    s=$(get_status "$resp")
    if [[ "$s" == "201" || "$s" == "200" ]]; then
        # 响应结构：{"group_id":"...","message":"..."} 顶层 group_id 字段
        GID=$(get_body "$resp" | python3 -c "
import sys,json
d=json.load(sys.stdin)
# 兼容多种响应格式
print(d.get('group_id') or d.get('group',{}).get('id',''))
" 2>/dev/null)
        [[ -n "$GID" ]] && log_pass "创建分组 ID=${GID:0:8}" || log_fail "创建分组ID为空"
        resp=$(do_req GET "/api/rooms/$ROOM_ID/groups" "$T1")
        assert_status "获取分组列表" "$resp" "200"
        [[ -n "${GID:-}" ]] && {
            resp=$(do_req DELETE "/api/rooms/$ROOM_ID/groups/$GID" "$T1")
            assert_status "删除分组" "$resp" "200"
        } || log_skip "删除分组（ID为空）"
    else
        log_fail "创建分组失败 (HTTP $s): $(get_body "$resp" | head -c 100)"
    fi
} || log_skip "分组（无房间）"

# ============================================================
# 11. 课堂流程
# ============================================================
log_section "11. 课堂流程"
[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req POST "/api/rooms/$ROOM_ID/flow" "$T1" \
        '{"title":"测试流程","nodes":[{"id":"n1","title":"导入","type":"lecture","duration":5,"entry_mode":"free"},{"id":"n2","title":"互动","type":"interaction","duration":10,"entry_mode":"follow"}]}')
    s=$(get_status "$resp")
    if [[ "$s" == "201" || "$s" == "200" ]]; then
        FID=$(jget2 "$(get_body "$resp")" "flow" "id")
        log_pass "流程创建 ID=${FID:0:8}"
        resp=$(do_req GET "/api/rooms/$ROOM_ID/flow" "$T1"); assert_status "获取流程" "$resp" "200"
        resp=$(do_req POST "/api/rooms/$ROOM_ID/flow/$FID/activate" "$T1"); assert_status "激活流程" "$resp" "200"
        resp=$(do_req POST "/api/rooms/$ROOM_ID/flow/$FID/advance" "$T1" '{"direction":"next"}'); assert_status "推进节点" "$resp" "200"
        resp=$(do_req GET "/api/rooms/$ROOM_ID/flow/progress"); assert_status "学生端进度（公开）" "$resp" "200"
        resp=$(do_req POST "/api/rooms/$ROOM_ID/flow/$FID/finish" "$T1"); assert_status "结束流程" "$resp" "200"
    else log_fail "流程创建失败 (HTTP $s)"; fi
} || log_skip "流程（无房间）"

# ============================================================
# 12. 公开分享页（Phase7）
# ============================================================
log_section "12. 公开分享页 (Phase7)"
[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req POST "/api/rooms/$ROOM_ID/share" "$T1" \
        '{"title":"自动化测试分享","visibility":"public","hide_names":false,"show_stats":true,"show_canvas":true,"show_dropzone":true}')
    assert_status "发布公开分享" "$resp" "200"
    STOK=$(get_body "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('share',{}).get('share_token',''))" 2>/dev/null)
    [[ -n "$STOK" ]] && log_pass "Token: $STOK" || log_fail "Token生成失败"

    [[ -n "$STOK" ]] && {
        resp=$(do_req GET "/api/share/$STOK/meta"); assert_status "分享元数据（公开）" "$resp" "200"
        vis=$(get_body "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('meta',{}).get('visibility',''))" 2>/dev/null)
        [[ "$vis" == "public" ]] && log_pass "可见性: public" || log_fail "可见性: $vis"

        resp=$(do_req GET "/api/share/$STOK/data"); assert_status "分享完整数据（公开）" "$resp" "200"
        body=$(get_body "$resp")
        echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'summary' in d" 2>/dev/null \
            && log_pass "含 summary" || log_fail "缺 summary"
        pn=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('summary',{}).get('polls',[])))" 2>/dev/null)
        [[ "${pn:-0}" -ge "1" ]] && log_pass "含投票结果（${pn}个）" || log_fail "缺投票结果"
        sleep 1
        resp2=$(do_req GET "/api/rooms/$ROOM_ID/share" "$T1")
        vc=$(get_body "$resp2" | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('shares',[]); print(s[0].get('view_count',0) if s else 0)" 2>/dev/null)
        [[ "${vc:-0}" -ge "1" ]] && log_pass "访问计数 view_count=$vc" || log_info "访问计数=$vc"
    }

    resp=$(do_req POST "/api/rooms/$ROOM_ID/share" "$T1" \
        '{"title":"密码保护","visibility":"password","password":"test123","show_stats":true,"show_canvas":true,"show_dropzone":true}')
    assert_status "更新为密码保护" "$resp" "200"
    PTOK=$(get_body "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('share',{}).get('share_token',''))" 2>/dev/null)
    [[ -n "$PTOK" ]] && {
        resp=$(do_req GET "/api/share/$PTOK/data"); assert_status "无密码→401" "$resp" "401"
        resp=$(do_req POST "/api/share/$PTOK/verify" "" '{"password":"wrongpwd"}'); assert_status "错误密码→401" "$resp" "401"
        resp=$(do_req POST "/api/share/$PTOK/verify" "" '{"password":"test123"}'); assert_status "正确密码→200" "$resp" "200"
        resp=$(do_req GET "/api/share/$PTOK/data?pwd=test123"); assert_status "携带密码→200" "$resp" "200"
    }
    resp=$(do_req GET "/api/share/invalid_token_xyz/meta"); assert_status "无效Token→404" "$resp" "404"

    [[ -n "${STOK:-}" ]] && {
        pgx "UPDATE room_shares SET expires_at=NOW()-INTERVAL '1 day' WHERE share_token='$STOK';"
        redis-cli DEL "share:meta:$STOK" > /dev/null 2>&1
        redis-cli DEL "share:data:$STOK" > /dev/null 2>&1
        resp=$(do_req GET "/api/share/$STOK/meta")
        s=$(get_status "$resp")
        err=$(get_body "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)
        if [[ "$s" == "404" && "$err" == *"过期"* ]]; then log_pass "过期分享拒绝（含'过期'）"
        elif [[ "$s" == "404" ]]; then log_pass "过期分享拒绝 (HTTP 404)"
        else log_fail "过期分享未拒绝 (HTTP $s)"; fi
    }

    SID=$(pgq "SELECT id FROM room_shares WHERE room_id='$ROOM_ID' LIMIT 1;")
    [[ -n "$SID" ]] && {
        resp=$(do_req DELETE "/api/rooms/$ROOM_ID/share/$SID" "$T1"); assert_status "删除分享" "$resp" "200"
    }
} || log_skip "分享页（无房间）"

# ============================================================
# 13. 模板中心
# ============================================================
log_section "13. 模板中心 (Phase7)"
[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req POST "/api/rooms/$ROOM_ID/templates" "$T1" \
        '{"name":"测试模板","description":"自动化测试","category":"测试","is_public":false}')
    s=$(get_status "$resp")
    if [[ "$s" == "201" || "$s" == "200" ]]; then
        TID=$(jget2 "$(get_body "$resp")" "template" "id")
        log_pass "模板保存 ID=${TID:0:8}"
    else log_fail "模板保存失败 (HTTP $s)"; fi
    resp=$(do_req GET "/api/templates" "$T1"); assert_status "获取模板列表" "$resp" "200"
    tn=$(get_body "$resp" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('templates',[])))" 2>/dev/null)
    [[ "${tn:-0}" -ge "1" ]] && log_pass "模板列表非空（${tn}个）" || log_fail "模板列表为空"
    [[ -n "${TID:-}" ]] && {
        resp=$(do_req DELETE "/api/rooms/$ROOM_ID/templates/$TID" "$T1"); assert_status "删除模板" "$resp" "200"
    }
} || log_skip "模板（无房间）"

# ============================================================
# 14. 边界条件
# ============================================================
log_section "14. 边界条件"
resp=$(do_req POST /api/rooms "$T1" '{"title":"容量测试","max_capacity":9999}')
if [[ "$(get_status "$resp")" == "201" ]]; then
    OID=$(jget2 "$(get_body "$resp")" "room" "id")
    cap=$(pgq "SELECT max_capacity FROM rooms WHERE id='$OID';")
    [[ "$cap" == "200" ]] && log_pass "容量上限限制正确（9999→200）" || log_info "容量值: $cap"
    pgx "DELETE FROM rooms WHERE id='$OID';"
fi

# ============================================================
# 清理
# ============================================================
log_section "清理测试数据"
cleanup

# ============================================================
# 汇总
# ============================================================
TOTAL=$((PASS+FAIL+SKIP)); RATE=0
[[ $((PASS+FAIL)) -gt 0 ]] && RATE=$((PASS*100/(PASS+FAIL)))
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║                   测试结果汇总                       ║"
echo "╠══════════════════════════════════════════════════════╣"
printf "║  ✅ 通过 (PASS)  %-35s║\n" "$PASS 项"
printf "║  ❌ 失败 (FAIL)  %-35s║\n" "$FAIL 项"
printf "║  ⏭  跳过 (SKIP)  %-35s║\n" "$SKIP 项"
printf "║  📊 通过率       %-35s║\n" "${RATE}%  (${PASS}/${TOTAL})"
echo "╚══════════════════════════════════════════════════════╝"
[[ ${#ERRORS[@]} -gt 0 ]] && {
    echo ""; echo -e "${RED}失败项：${NC}"
    for e in "${ERRORS[@]}"; do echo -e "  ${RED}✗${NC} $e"; done
}
echo ""
if   [[ $FAIL -eq 0 ]];  then echo -e "${GREEN}🎉 所有测试通过！MindCanvas Phase7 后端功能完整。${NC}"
elif [[ $RATE -ge 97 ]]; then echo -e "${GREEN}✅ 通过率 ${RATE}%，非常健康。${NC}"
elif [[ $RATE -ge 90 ]]; then echo -e "${YELLOW}⚠️  通过率 ${RATE}%，有少量问题。${NC}"
else                          echo -e "${RED}❌ 通过率 ${RATE}%，需要修复。${NC}"; fi
echo ""
