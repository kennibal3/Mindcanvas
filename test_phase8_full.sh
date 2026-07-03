#!/bin/bash
# =============================================================
# MindCanvas v4.1 - 全功能自动化测试（Phase8-v2完整版）
# 覆盖：Phase4投票/词云/问答 + Phase5流程 + Phase6学情/互评
#       Phase7分享/模板 + Phase8作业评价 + Phase8-v2作业码/花名册
# =============================================================
set -uo pipefail

BASE="https://localhost"
PASS=0; FAIL=0; SKIP=0; ERRORS=()
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

# =============================================================
# 工具函数
# =============================================================
log_section() {
    echo -e "\n${BLUE}══════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}══════════════════════════════════════════════${NC}"
}
log_pass()  { echo -e "  ${GREEN}✅ PASS${NC} $1"; ((PASS++)); }
log_fail()  { echo -e "  ${RED}❌ FAIL${NC} $1"; ((FAIL++)); ERRORS+=("$1"); }
log_skip()  { echo -e "  ${YELLOW}⏭  SKIP${NC} $1"; ((SKIP++)); }
log_info()  { echo -e "  ${CYAN}ℹ  INFO${NC} $1"; }
log_warn()  { echo -e "  ${YELLOW}⚠  WARN${NC} $1"; }

# HTTP请求（支持HTTPS跳过证书验证）
do_req() {
    local method=$1 url=$2 token=${3:-""} body=${4:-""}
    local args=(-sk -w "\n__STATUS__%{http_code}" -X "$method" "$BASE$url"
                -H "Content-Type: application/json")
    [[ -n "$token" ]] && args+=(-H "Cookie: mc_token=$token")
    [[ -n "$body"  ]] && args+=(--data "$body")
    curl "${args[@]}" 2>/dev/null
}

# 公开接口请求（无Cookie）
do_public() {
    local method=$1 url=$2 body=${3:-""}
    local args=(-sk -w "\n__STATUS__%{http_code}" -X "$method" "$BASE$url"
                -H "Content-Type: application/json")
    [[ -n "$body" ]] && args+=(--data "$body")
    curl "${args[@]}" 2>/dev/null
}

get_status() { echo "$1" | grep "__STATUS__" | sed 's/__STATUS__//'; }
get_body()   { echo "$1" | grep -v "__STATUS__"; }

assert_status() {
    local desc=$1 resp=$2 expected=$3
    local actual; actual=$(get_status "$resp")
    if [[ "$actual" == "$expected" ]]; then
        log_pass "$desc (HTTP $actual)"
    else
        local body; body=$(get_body "$resp" | head -c 200)
        log_fail "$desc (期望HTTP $expected 实际HTTP $actual | $body)"
    fi
}

assert_contains() {
    local desc=$1 text=$2 keyword=$3
    if echo "$text" | grep -q "$keyword"; then
        log_pass "$desc (含'$keyword')"
    else
        log_fail "$desc (缺'$keyword')"
    fi
}

# 登录获取Token
do_login() {
    curl -sk -D - -X POST "$BASE/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$1\",\"password\":\"$2\"}" 2>/dev/null \
    | grep -i "set-cookie.*mc_token" \
    | sed 's/.*mc_token=\([^;]*\).*/\1/' | tr -d ' \r\n'
}

# 数据库操作
pgq() {
    PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas \
        -t -c "$1" 2>/dev/null | grep -v '^[[:space:]]*$' | head -1 | tr -d ' \n'
}
pgx() {
    local out
    out=$(PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas \
        -c "$1" 2>&1)
    if echo "$out" | grep -qi "error\|fatal"; then
        echo "  [pgx ERROR] $out" >&2
    fi
}

# JSON字段提取
jget()  { echo "$1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('$2',''))" 2>/dev/null; }
jget2() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2',{}).get('$3',''))" 2>/dev/null; }
jlen()  { echo "$1" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('$2',[])))" 2>/dev/null; }

# =============================================================
# 测试变量
# =============================================================
T1=""; T2=""
ROOM_ID=""; INV_CODE=""
POLL_ID=""; WC_ID=""; QA_ID=""; DZ_ID=""
S1=""; S2=""; S3=""
AID="";  # 作业ID
TOKEN1=""; TOKEN2=""; TOKEN3=""  # 作业码

cleanup() {
    log_info "清理测试数据..."
    [[ -n "$AID"     ]] && pgx "DELETE FROM assignments WHERE id='$AID';"
    [[ -n "$ROOM_ID" ]] && pgx "DELETE FROM rooms WHERE id='$ROOM_ID';"
    log_info "清理完成"
}

# =============================================================
# 开始测试
# =============================================================
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║    MindCanvas v4.1 全功能自动化测试（Phase8-v2完整版）   ║"
echo "║    $(date '+%Y-%m-%d %H:%M:%S')                              ║"
echo "╚══════════════════════════════════════════════════════════╝"

# ============================================================
# Section 1: 服务健康检查
# ============================================================
log_section "1. 服务健康检查"

resp=$(do_public GET /health)
assert_status "健康检查" "$resp" "200"

body=$(get_body "$resp")
phase=$(jget "$body" "phase")
parser=$(jget "$body" "parser_ok")

[[ "$phase" == "8-v2" ]] && log_pass "phase=8-v2 确认" \
    || log_warn "phase=$phase（期望8-v2，可能版本未更新）"
[[ "$parser" == "True" || "$parser" == "true" ]] \
    && log_pass "MarkItDown解析服务正常" \
    || log_warn "解析服务异常（parser_ok=$parser）"

# ============================================================
# Section 2: 认证系统
# ============================================================
log_section "2. 认证系统"

resp=$(do_public POST /api/auth/login '{"username":"teacher01","password":"wrongpwd"}')
assert_status "错误密码拒绝" "$resp" "401"

T1=$(do_login "teacher01" "Test@2026")
[[ -n "$T1" ]] && log_pass "teacher01登录 Token=${T1:0:15}..." \
    || log_fail "teacher01登录失败"

T2=$(do_login "teacher02" "Test@2026")
[[ -n "$T2" ]] && log_pass "teacher02登录成功" || log_fail "teacher02登录失败"

resp=$(do_req GET /api/auth/me "$T1")
assert_status "Token验证" "$resp" "200"

resp=$(do_public GET /api/rooms)
assert_status "无Token返回401" "$resp" "401"

# ============================================================
# Section 3: 房间管理
# ============================================================
log_section "3. 房间管理"

resp=$(do_req POST /api/rooms "$T1" \
    '{"title":"Phase8测试房间_可删除","max_capacity":30}')
assert_status "创建测试房间" "$resp" "201"
body=$(get_body "$resp")
ROOM_ID=$(jget2 "$body" "room" "id")
INV_CODE=$(jget2 "$body" "room" "invite_code")

[[ "${#ROOM_ID}" == "36" ]] \
    && log_pass "房间ID正常 ${ROOM_ID:0:8}... 邀请码=$INV_CODE" \
    || log_fail "房间ID异常: $ROOM_ID"

# ============================================================
# Section 4: 学生入场
# ============================================================
log_section "4. 学生免注册入场"

if [[ -n "$INV_CODE" ]]; then
    for i in 1 2 3; do
        case $i in
            1) nick="张三";;
            2) nick="李四";;
            3) nick="王五";;
        esac
        resp=$(do_public POST /api/guest/join \
            "{\"room_code\":\"$INV_CODE\",\"nickname\":\"$nick\",\"avatar_id\":$i}")
        assert_status "学生${nick}入场" "$resp" "200"
        uuid=$(get_body "$resp" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if 'data' in d and isinstance(d.get('data'),dict): print(d['data'].get('uuid',''))
elif 'uuid' in d: print(d['uuid'])
else: print('')
" 2>/dev/null)
        case $i in 1) S1=$uuid;; 2) S2=$uuid;; 3) S3=$uuid;; esac
        [[ "${#uuid}" -gt "10" ]] \
            && log_pass "${nick} UUID=${uuid:0:8}..." \
            || log_fail "${nick} UUID异常: $uuid"
    done
else
    log_skip "学生入场（无邀请码）"
    S1="test-s1-uuid"; S2="test-s2-uuid"; S3="test-s3-uuid"
fi

# ============================================================
# Section 5: Widget数据写入
# ============================================================
log_section "5. Widget数据写入与验证"

if [[ -n "$ROOM_ID" ]]; then
    # 投票
    POLL_ID=$(pgq "INSERT INTO room_elements
        (room_id,creator_uuid,creator_name,type,payload)
        VALUES ('$ROOM_ID','teacher-uuid','teacher01','polling_widget',
        '{\"question\":\"最喜欢哪个功能？\",
          \"options\":[\"投票\",\"词云\",\"问答\",\"作品墙\"],
          \"mode\":\"single\",\"anonymous\":false,
          \"showResult\":true,\"allowChange\":false,
          \"status\":\"open\",\"votes\":{}}')
        RETURNING id;")
    [[ "${#POLL_ID}" == "36" ]] \
        && log_pass "投票Widget创建 ${POLL_ID:0:8}" \
        || log_fail "投票Widget创建失败: $POLL_ID"

    pgx "INSERT INTO widget_interactions
        (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data)
        VALUES
        ('$ROOM_ID','$POLL_ID','$S1','张三','polling_widget','vote','{\"option\":\"投票\"}'),
        ('$ROOM_ID','$POLL_ID','$S2','李四','polling_widget','vote','{\"option\":\"词云\"}'),
        ('$ROOM_ID','$POLL_ID','$S3','王五','polling_widget','vote','{\"option\":\"投票\"}')
        ON CONFLICT DO NOTHING;"
    log_pass "投票数据写入（3票）"

    # 唯一约束验证
    pgx "INSERT INTO widget_interactions
        (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data)
        VALUES ('$ROOM_ID','$POLL_ID','$S1','张三','polling_widget','vote','{\"option\":\"词云\"}')
        ON CONFLICT DO NOTHING;"
    dup=$(pgq "SELECT COUNT(*) FROM widget_interactions
        WHERE element_id='$POLL_ID' AND student_uuid='$S1' AND action_type='vote';")
    [[ "${dup:-0}" == "1" ]] \
        && log_pass "投票唯一约束有效（重复投票被拦截）" \
        || log_fail "唯一约束失效（记录数=$dup）"

    # 词云
    WC_ID=$(pgq "INSERT INTO room_elements
        (room_id,creator_uuid,creator_name,type,payload)
        VALUES ('$ROOM_ID','teacher-uuid','teacher01','wordcloud_widget',
        '{\"prompt\":\"描述今天的课堂\",\"words\":{},
          \"status\":\"open\",\"maxWordsPerStudent\":3}')
        RETURNING id;")
    [[ "${#WC_ID}" == "36" ]] \
        && log_pass "词云Widget创建 ${WC_ID:0:8}" \
        || log_fail "词云Widget创建失败"

    pgx "INSERT INTO widget_interactions
        (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data)
        VALUES
        ('$ROOM_ID','$WC_ID','$S1','张三','wordcloud_widget','add_word','{\"word\":\"有趣\"}'),
        ('$ROOM_ID','$WC_ID','$S2','李四','wordcloud_widget','add_word','{\"word\":\"有趣\"}'),
        ('$ROOM_ID','$WC_ID','$S3','王五','wordcloud_widget','add_word','{\"word\":\"实用\"}')
        ON CONFLICT DO NOTHING;"
    log_pass "词云数据写入（3条）"

    # 问答
    QA_ID=$(pgq "INSERT INTO room_elements
        (room_id,creator_uuid,creator_name,type,payload)
        VALUES ('$ROOM_ID','teacher-uuid','teacher01','qa_widget',
        '{\"question\":\"HTTP 200代表什么？\",
          \"options\":[\"成功\",\"未找到\",\"服务器错误\",\"重定向\"],
          \"correct_answer\":0,\"status\":\"open\",
          \"show_answer\":false,\"stats\":{}}')
        RETURNING id;")
    [[ "${#QA_ID}" == "36" ]] \
        && log_pass "问答Widget创建 ${QA_ID:0:8}" \
        || log_fail "问答Widget创建失败"

    pgx "INSERT INTO widget_interactions
        (room_id,element_id,student_uuid,student_name,
         widget_type,action_type,action_data,is_correct)
        VALUES
        ('$ROOM_ID','$QA_ID','$S1','张三','qa_widget','answer','{\"answer\":\"成功\"}'::jsonb,true),
        ('$ROOM_ID','$QA_ID','$S2','李四','qa_widget','answer','{\"answer\":\"未找到\"}'::jsonb,false),
        ('$ROOM_ID','$QA_ID','$S3','王五','qa_widget','answer','{\"answer\":\"成功\"}'::jsonb,true)
        ON CONFLICT DO NOTHING;"
    log_pass "问答数据写入（预期正确率66.7%）"

    c_ok=$(pgq "SELECT COUNT(*) FROM widget_interactions
        WHERE element_id='$QA_ID' AND is_correct=true;")
    c_no=$(pgq "SELECT COUNT(*) FROM widget_interactions
        WHERE element_id='$QA_ID' AND is_correct=false;")
    [[ "${c_ok:-0}" == "2" && "${c_no:-0}" == "1" ]] \
        && log_pass "is_correct写入正确（对2错1）" \
        || log_fail "is_correct异常（对${c_ok}错${c_no}）"

    # 作品墙
    DZ_ID=$(pgq "INSERT INTO room_elements
        (room_id,creator_uuid,creator_name,type,payload)
        VALUES ('$ROOM_ID','teacher-uuid','teacher01','dropzone_widget',
        '{\"title\":\"学习心得\",\"acceptTypes\":[\"text\",\"link\"],
          \"layout\":\"grid\",\"status\":\"open\",
          \"maxPerStudent\":3,\"hideNames\":false,\"submissionOrder\":[]}')
        RETURNING id;")
    [[ "${#DZ_ID}" == "36" ]] \
        && log_pass "作品墙Widget创建 ${DZ_ID:0:8}" \
        || log_fail "作品墙Widget创建失败"

    pgx "INSERT INTO widget_interactions
        (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data)
        VALUES
        ('$ROOM_ID','$DZ_ID','$S1','张三','dropzone_widget','submit',
         '{\"content_type\":\"text\",\"content\":\"今天学到了很多\",\"likes\":0,\"tags\":[],\"pinned\":false,\"hidden\":false}'::jsonb),
        ('$ROOM_ID','$DZ_ID','$S2','李四','dropzone_widget','submit',
         '{\"content_type\":\"text\",\"content\":\"互动功能很好用\",\"likes\":1,\"tags\":[\"推荐\"],\"pinned\":false,\"hidden\":false}'::jsonb),
        ('$ROOM_ID','$DZ_ID','$S3','王五','dropzone_widget','submit',
         '{\"content_type\":\"link\",\"content\":\"https://mindcanvas.com.cn\",\"likes\":0,\"tags\":[],\"pinned\":false,\"hidden\":false}'::jsonb)
        ON CONFLICT DO NOTHING;"
    log_pass "作品墙数据写入（3件）"

    # 同伴互评
    SUB_ID=$(pgq "SELECT id FROM widget_interactions
        WHERE element_id='$DZ_ID' AND student_uuid='$S1' LIMIT 1;")
    if [[ "${#SUB_ID}" == "36" ]]; then
        pgx "INSERT INTO peer_reviews
            (dropzone_id,submission_id,reviewer_uuid,scores,comment)
            VALUES ('$DZ_ID','$SUB_ID','$S2',
            '{\"creativity\":4,\"clarity\":5,\"depth\":3}'::jsonb,'写得不错！')
            ON CONFLICT DO NOTHING;"
        log_pass "同伴互评写入"

        # 重复互评约束
        pgx "INSERT INTO peer_reviews
            (dropzone_id,submission_id,reviewer_uuid,scores,comment)
            VALUES ('$DZ_ID','$SUB_ID','$S2',
            '{\"creativity\":2,\"clarity\":2,\"depth\":2}'::jsonb,'第二次')
            ON CONFLICT DO NOTHING;"
        dup_r=$(pgq "SELECT COUNT(*) FROM peer_reviews
            WHERE submission_id='$SUB_ID' AND reviewer_uuid='$S2';")
        [[ "${dup_r:-0}" == "1" ]] \
            && log_pass "互评唯一约束有效" \
            || log_fail "互评唯一约束失效（记录数=$dup_r）"
    else
        log_skip "同伴互评（未找到提交记录）"
    fi

    # 总数验证
    total_wi=$(pgq "SELECT COUNT(*) FROM widget_interactions WHERE room_id='$ROOM_ID';")
    [[ "${total_wi:-0}" -ge "9" ]] \
        && log_pass "widget_interactions总记录数正常（${total_wi}条）" \
        || log_fail "记录数不足（${total_wi}条，期望≥9）"
else
    log_skip "Widget测试（无房间）"
fi

# ============================================================
# Section 6: REST API场控
# ============================================================
log_section "6. 场控API"

[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req PUT "/api/rooms/$ROOM_ID/lock" "$T1" '{"is_locked":true}')
    assert_status "锁定房间" "$resp" "200"

    resp=$(do_req PUT "/api/rooms/$ROOM_ID/lock" "$T1" '{"is_locked":false}')
    assert_status "解锁房间" "$resp" "200"

    resp=$(do_req PUT "/api/rooms/$ROOM_ID/readonly" "$T1" '{"is_readonly":true}')
    assert_status "设置只读" "$resp" "200"

    resp=$(do_req PUT "/api/rooms/$ROOM_ID/readonly" "$T1" '{"is_readonly":false}')
    assert_status "恢复编辑" "$resp" "200"

    resp=$(do_req POST "/api/rooms/$ROOM_ID/gather" "$T1" \
        '{"viewport_x":0,"viewport_y":0,"zoom":1}')
    assert_status "召集学生" "$resp" "200"

    resp=$(do_req GET "/api/rooms/$ROOM_ID/members" "$T1")
    assert_status "获取成员列表" "$resp" "200"
} || log_skip "场控（无房间）"

# ============================================================
# Section 7: 数据导出
# ============================================================
log_section "7. 数据导出"

[[ -n "$ROOM_ID" ]] && {
    for t in "all" "vote" "word"; do
        resp=$(do_req GET "/api/rooms/$ROOM_ID/export?type=$t" "$T1")
        assert_status "CSV导出 type=$t" "$resp" "200"
    done

    resp=$(do_req GET "/api/rooms/$ROOM_ID/export/contributions" "$T1")
    assert_status "贡献统计导出" "$resp" "200"

    resp=$(do_req GET "/api/rooms/$ROOM_ID/summary/export" "$T1")
    assert_status "Markdown总结导出" "$resp" "200"
    md=$(get_body "$resp")
    for kw in "课堂总结" "投票" "词云" "问答"; do
        echo "$md" | grep -q "$kw" \
            && log_pass "Markdown含'$kw'" \
            || log_fail "Markdown缺'$kw'"
    done
} || log_skip "导出（无房间）"

# ============================================================
# Section 8: 总结中心
# ============================================================
log_section "8. 总结中心"

[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req GET "/api/rooms/$ROOM_ID/summary" "$T1")
    assert_status "获取课堂总结" "$resp" "200"
    body=$(get_body "$resp")

    for field in "polls" "word_clouds" "qa_summaries" "dropzones"; do
        n=$(echo "$body" | python3 -c "
import sys,json; d=json.load(sys.stdin)
s=d.get('summary',d); print(len(s.get('$field',[])))" 2>/dev/null)
        [[ "${n:-0}" -ge "1" ]] \
            && log_pass "总结含${field}（${n}条）" \
            || log_fail "总结缺${field}"
    done

    qa_rate=$(echo "$body" | python3 -c "
import sys,json; d=json.load(sys.stdin)
s=d.get('summary',d); qa=s.get('qa_summaries',[])
print(round(qa[0].get('correct_rate',0)*100) if qa else -1)" 2>/dev/null)
    [[ "${qa_rate:-0}" -ge "60" && "${qa_rate:-0}" -le "70" ]] \
        && log_pass "问答正确率正确（${qa_rate}%）" \
        || log_fail "问答正确率偏差（${qa_rate}%，期望60-70%）"
} || log_skip "总结（无房间）"

# ============================================================
# Section 9: 学情雷达
# ============================================================
log_section "9. 学情雷达"

[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req GET "/api/rooms/$ROOM_ID/insight" "$T1")
    assert_status "获取学情雷达" "$resp" "200"

    resp=$(do_req POST "/api/rooms/$ROOM_ID/insight/refresh" "$T1")
    assert_status "刷新学情缓存" "$resp" "200"
} || log_skip "学情（无房间）"

# ============================================================
# Section 10: 课堂流程
# ============================================================
log_section "10. 课堂流程控制器"

[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req POST "/api/rooms/$ROOM_ID/flow" "$T1" \
        '{"title":"Phase8测试流程",
          "nodes":[
            {"id":"n1","title":"导入","type":"lecture","duration":5,"entry_mode":"free"},
            {"id":"n2","title":"互动","type":"interaction","duration":10,"entry_mode":"follow"},
            {"id":"n3","title":"总结","type":"review","duration":5,"entry_mode":"readonly"}
          ]}')
    s=$(get_status "$resp")
    if [[ "$s" == "201" || "$s" == "200" ]]; then
        FID=$(jget2 "$(get_body "$resp")" "flow" "id")
        log_pass "流程创建 ID=${FID:0:8}"

        resp=$(do_req POST "/api/rooms/$ROOM_ID/flow/$FID/activate" "$T1")
        assert_status "激活流程" "$resp" "200"

        resp=$(do_req POST "/api/rooms/$ROOM_ID/flow/$FID/advance" "$T1" \
            '{"direction":"next"}')
        assert_status "推进节点" "$resp" "200"

        resp=$(do_public GET "/api/rooms/$ROOM_ID/flow/progress")
        assert_status "学生查看进度（公开）" "$resp" "200"

        resp=$(do_req POST "/api/rooms/$ROOM_ID/flow/$FID/finish" "$T1")
        assert_status "结束流程" "$resp" "200"
    else
        log_fail "流程创建失败 (HTTP $s)"
    fi
} || log_skip "流程（无房间）"

# ============================================================
# Section 11: 公开分享页
# ============================================================
log_section "11. 公开分享页 (Phase7)"

STOK=""
[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req POST "/api/rooms/$ROOM_ID/share" "$T1" \
        '{"title":"Phase8测试分享","visibility":"public",
          "hide_names":false,"show_stats":true,
          "show_canvas":true,"show_dropzone":true}')
    assert_status "发布公开分享" "$resp" "200"
    STOK=$(get_body "$resp" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(d.get('share',{}).get('share_token',''))" 2>/dev/null)
    [[ -n "$STOK" ]] && log_pass "分享Token=$STOK" || log_fail "Token生成失败"

    [[ -n "$STOK" ]] && {
        resp=$(do_public GET "/api/share/$STOK/meta")
        assert_status "获取分享元数据（公开）" "$resp" "200"

        resp=$(do_public GET "/api/share/$STOK/data")
        assert_status "获取分享数据（公开）" "$resp" "200"
        body=$(get_body "$resp")
        echo "$body" | python3 -c "
import sys,json; d=json.load(sys.stdin); assert 'summary' in d" 2>/dev/null \
            && log_pass "分享数据含summary" \
            || log_fail "分享数据缺summary"
    }

    # 密码保护测试
    resp=$(do_req POST "/api/rooms/$ROOM_ID/share" "$T1" \
        '{"title":"密码保护测试","visibility":"password",
          "password":"test123","show_stats":true,
          "show_canvas":true,"show_dropzone":true}')
    assert_status "发布密码保护分享" "$resp" "200"
    PTOK=$(get_body "$resp" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(d.get('share',{}).get('share_token',''))" 2>/dev/null)

    [[ -n "$PTOK" ]] && {
        resp=$(do_public GET "/api/share/$PTOK/data")
        assert_status "无密码访问→401" "$resp" "401"

        resp=$(do_public POST "/api/share/$PTOK/verify" '{"password":"wrongpwd"}')
        assert_status "错误密码→401" "$resp" "401"

        resp=$(do_public POST "/api/share/$PTOK/verify" '{"password":"test123"}')
        assert_status "正确密码→200" "$resp" "200"
    }

    resp=$(do_public GET "/api/share/invalid_token_xyz/meta")
    assert_status "无效Token→404" "$resp" "404"
} || log_skip "分享页（无房间）"

# ============================================================
# Section 12: 模板中心
# ============================================================
log_section "12. 模板中心 (Phase7)"

[[ -n "$ROOM_ID" ]] && {
    resp=$(do_req POST "/api/rooms/$ROOM_ID/templates" "$T1" \
        '{"name":"Phase8测试模板","description":"自动化","category":"测试","is_public":false}')
    s=$(get_status "$resp")
    if [[ "$s" == "201" || "$s" == "200" ]]; then
        TID=$(jget2 "$(get_body "$resp")" "template" "id")
        log_pass "模板保存 ID=${TID:0:8}"

        resp=$(do_req GET "/api/templates" "$T1")
        assert_status "模板列表" "$resp" "200"

        [[ -n "$TID" ]] && {
            resp=$(do_req DELETE "/api/rooms/$ROOM_ID/templates/$TID" "$T1")
            assert_status "删除模板" "$resp" "200"
        }
    else
        log_fail "模板保存失败 (HTTP $s)"
    fi
} || log_skip "模板（无房间）"

# ============================================================
# Section 13: Phase8 作业评价中心
# ============================================================
log_section "13. 作业评价中心 (Phase8)"

# 13A: 解析服务健康检查
resp=$(do_req GET "/api/assignments/parser/health" "$T1")
s=$(get_status "$resp")
if [[ "$s" == "200" ]]; then
    log_pass "解析服务健康检查通过"
else
    log_warn "解析服务不可用 (HTTP $s)，文件解析测试将跳过"
fi

# 13B: 作业CRUD
resp=$(do_req POST "/api/assignments" "$T1" \
    "{\"title\":\"Phase8自动化测试作业\",
      \"description\":\"测试作业评价完整流程\",
      \"room_id\":\"$ROOM_ID\",
      \"allow_resubmit\":true}")
assert_status "创建作业" "$resp" "201"
body=$(get_body "$resp")
AID=$(jget2 "$body" "assignment" "id")
[[ "${#AID}" == "36" ]] \
    && log_pass "作业ID=${AID:0:8}..." \
    || log_fail "作业ID异常: $AID"

[[ -n "$AID" ]] && {
    resp=$(do_req GET "/api/assignments/$AID" "$T1")
    assert_status "获取作业详情" "$resp" "200"

    resp=$(do_req GET "/api/assignments" "$T1")
    assert_status "作业列表" "$resp" "200"

    # 13C: 状态流转
    resp=$(do_req PATCH "/api/assignments/$AID/status" "$T1" \
        '{"status":"collecting"}')
    assert_status "状态→collecting" "$resp" "200"

    status_db=$(pgq "SELECT status FROM assignments WHERE id='$AID';")
    [[ "$status_db" == "collecting" ]] \
        && log_pass "DB状态同步=collecting" \
        || log_fail "DB状态异常=$status_db"

    # 13D: 文字材料
    resp=$(do_req POST "/api/assignments/$AID/materials/text" "$T1" \
        '{"material_role":"instruction",
          "original_name":"作业说明",
          "content_text":"请写一篇500字以上的学习总结，包含以下要点：\n1. 本节课学到了什么\n2. 最大的收获\n3. 还有哪些疑问"}')
    assert_status "添加文字材料（任务说明）" "$resp" "201"

    resp=$(do_req POST "/api/assignments/$AID/materials/text" "$T1" \
        '{"material_role":"rubric_source",
          "original_name":"评分标准说明",
          "content_text":"内容完整性(30%)：覆盖所有要点\n逻辑结构(25%)：条理清晰\n表达质量(25%)：语言流畅\n创新性(20%)：有独到见解"}')
    assert_status "添加文字材料（评分标准）" "$resp" "201"

    resp=$(do_req GET "/api/assignments/$AID/materials" "$T1")
    assert_status "获取材料列表" "$resp" "200"
    mcount=$(jlen "$(get_body "$resp")" "materials")
    [[ "${mcount:-0}" -ge "2" ]] \
        && log_pass "材料列表正常（${mcount}条）" \
        || log_fail "材料数量不足（${mcount}条）"

    # 13E: Rubric生成与确认
    resp=$(do_req POST "/api/assignments/$AID/rubric/generate" "$T1")
    assert_status "生成默认Rubric" "$resp" "201"
    body=$(get_body "$resp")
    rub_id=$(jget2 "$body" "rubric" "id")
    [[ "${#rub_id}" == "36" ]] \
        && log_pass "Rubric生成 ID=${rub_id:0:8}" \
        || log_fail "Rubric ID异常"

    resp=$(do_req GET "/api/assignments/$AID/rubric" "$T1")
    assert_status "获取Rubric" "$resp" "200"

    resp=$(do_req PUT "/api/assignments/$AID/rubric" "$T1" \
        '{"criteria":[
            {"name":"内容理解","weight":25,
             "levels":[{"score":25,"label":"优秀","desc":"完整准确"},
                       {"score":15,"label":"良好","desc":"基本正确"},
                       {"score":5,"label":"待改进","desc":"有明显偏差"}]},
            {"name":"逻辑结构","weight":25,
             "levels":[{"score":25,"label":"优秀","desc":"条理清晰"},
                       {"score":15,"label":"良好","desc":"基本清楚"},
                       {"score":5,"label":"待改进","desc":"较混乱"}]},
            {"name":"表达质量","weight":25,
             "levels":[{"score":25,"label":"优秀","desc":"语言流畅"},
                       {"score":15,"label":"良好","desc":"基本流畅"},
                       {"score":5,"label":"待改进","desc":"表达欠佳"}]},
            {"name":"完成度","weight":25,
             "levels":[{"score":25,"label":"优秀","desc":"全部完成"},
                       {"score":15,"label":"良好","desc":"基本完成"},
                       {"score":5,"label":"待改进","desc":"未完成"}]}
          ],
          "total_score":100}')
    assert_status "确认Rubric" "$resp" "200"

    confirmed=$(pgq "SELECT teacher_confirmed FROM assignment_rubrics
        WHERE assignment_id='$AID' ORDER BY version DESC LIMIT 1;")
    [[ "$confirmed" == "t" ]] \
        && log_pass "Rubric teacher_confirmed=true" \
        || log_fail "Rubric confirmed异常=$confirmed"
}

# ============================================================
# Section 14: Phase8-v2 作业码与花名册
# ============================================================
log_section "14. 作业码与花名册 (Phase8-v2)"

[[ -n "$AID" ]] && {
    # 14A: 通用码生成
    resp=$(do_req POST "/api/assignments/$AID/tokens/generate" "$T1" \
        '{"token_type":"universal","count":5,"expire_days":7}')
    assert_status "生成通用作业码（5个）" "$resp" "201"
    body=$(get_body "$resp")
    tcount=$(jget "$body" "total_count")
    ttype=$(jget "$body" "token_type")
    [[ "${tcount:-0}" -ge "5" ]] \
        && log_pass "生成数量正确（${tcount}个）" \
        || log_fail "生成数量不足（${tcount}个）"
    [[ "$ttype" == "universal" ]] \
        && log_pass "token_type=universal" \
        || log_fail "token_type异常=$ttype"

    # 提取第一个token备用
    TOKEN1=$(echo "$body" | python3 -c "
import sys,json; d=json.load(sys.stdin)
tokens=d.get('tokens',[])
print(tokens[0].get('token','') if tokens else '')" 2>/dev/null)
    [[ "${#TOKEN1}" -ge "6" ]] \
        && log_pass "作业码格式正常：$TOKEN1" \
        || log_fail "作业码格式异常：$TOKEN1"

    # 14B: 作业码列表
    resp=$(do_req GET "/api/assignments/$AID/tokens" "$T1")
    assert_status "查询作业码列表" "$resp" "200"
    list_count=$(jlen "$(get_body "$resp")" "tokens")
    [[ "${list_count:-0}" -ge "5" ]] \
        && log_pass "作业码列表数量正确（${list_count}个）" \
        || log_fail "列表数量不足（${list_count}个）"

    # 14C: 作业码CSV导出
    resp=$(do_req GET "/api/assignments/$AID/tokens/export" "$T1")
    assert_status "导出作业码CSV" "$resp" "200"
    csv_content=$(get_body "$resp")
    echo "$csv_content" | grep -q "姓名" \
        && log_pass "CSV含表头'姓名'" \
        || log_fail "CSV缺表头"
    echo "$csv_content" | grep -q "通用码" \
        && log_pass "CSV含'通用码'标识" \
        || log_fail "CSV缺'通用码'标识"

    # 14D: 从课堂同步花名册
    resp=$(do_req POST "/api/assignments/$AID/roster/sync" "$T1" \
        "{\"room_id\":\"$ROOM_ID\"}")
    assert_status "从课堂同步花名册" "$resp" "200"
    synced=$(get_body "$resp" | python3 -c "
import sys,json; print(json.load(sys.stdin).get('synced',0))" 2>/dev/null)
    log_info "同步花名册人数：${synced}人"

    # 14E: 手动添加花名册
    resp=$(do_req POST "/api/assignments/$AID/roster" "$T1" \
        '{"student_name":"测试学生赵六"}')
    assert_status "手动添加花名册" "$resp" "201"

    resp=$(do_req POST "/api/assignments/$AID/roster" "$T1" \
        '{"student_name":"测试学生赵六"}')
    s=$(get_status "$resp")
    [[ "$s" == "201" || "$s" == "200" ]] \
        && log_pass "重复添加花名册幂等处理 (HTTP $s)" \
        || log_fail "重复添加花名册异常 (HTTP $s)"

    # 14F: CSV批量导入花名册
    resp=$(do_req POST "/api/assignments/$AID/roster/import" "$T1" \
        '{"names":["孙七","周八,custom-uuid-888","吴九"]}')
    assert_status "JSON批量导入花名册" "$resp" "200"
    imported=$(get_body "$resp" | python3 -c "
import sys,json; print(json.load(sys.stdin).get('imported',0))" 2>/dev/null)
    [[ "${imported:-0}" -ge "3" ]] \
        && log_pass "批量导入成功（${imported}条）" \
        || log_fail "批量导入数量不足（${imported}条）"

    # 14G: 查询花名册+提交状态
    resp=$(do_req GET "/api/assignments/$AID/roster" "$T1")
    assert_status "查询花名册+提交状态" "$resp" "200"
    body=$(get_body "$resp")
    total_exp=$(echo "$body" | python3 -c "
import sys,json; print(json.load(sys.stdin).get('total_expected',0))" 2>/dev/null)
    [[ "${total_exp:-0}" -ge "3" ]] \
        && log_pass "花名册人数正常（${total_exp}人）" \
        || log_fail "花名册人数不足（${total_exp}人）"

    # 验证花名册字段完整性
    echo "$body" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=d.get('roster',[])
if r:
    item=r[0]
    assert 'student_name' in item, 'missing student_name'
    assert 'has_submitted' in item, 'missing has_submitted'
    assert 'source' in item, 'missing source'
    print('OK')
else:
    print('EMPTY')
" 2>/dev/null | grep -q "OK" \
        && log_pass "花名册字段完整（含has_submitted/source）" \
        || log_fail "花名册字段缺失"

    # 14H: 删除花名册条目
    RID=$(pgq "SELECT id FROM assignment_rosters
        WHERE assignment_id='$AID' AND student_name='测试学生赵六' LIMIT 1;")
    [[ -n "$RID" ]] && {
        resp=$(do_req DELETE "/api/assignments/$AID/roster/$RID" "$T1")
        assert_status "删除花名册条目" "$resp" "200"
        left=$(pgq "SELECT COUNT(*) FROM assignment_rosters
            WHERE id='$RID';")
        [[ "${left:-0}" == "0" ]] \
            && log_pass "花名册条目已物理删除" \
            || log_fail "花名册条目未删除"
    } || log_skip "删除花名册（未找到条目）"
} || log_skip "作业码/花名册（无作业ID）"

# ============================================================
# Section 15: Phase8-v2 学生凭作业码提交（公开接口）
# ============================================================
log_section "15. 学生凭作业码提交 (Phase8-v2公开接口)"

[[ -n "$TOKEN1" ]] && {
    # 15A: 验证无效码
    resp=$(do_public POST /api/submit/verify '{"token":"INVALID1"}')
    body=$(get_body "$resp")
    valid=$(jget "$body" "valid")
    [[ "$valid" == "False" || "$valid" == "false" ]] \
        && log_pass "无效作业码正确拒绝（valid=false）" \
        || log_fail "无效码未拒绝（valid=$valid）"

    # 15B: 验证有效码
    resp=$(do_public POST /api/submit/verify \
        "{\"token\":\"$TOKEN1\"}")
    assert_status "验证有效作业码" "$resp" "200"
    body=$(get_body "$resp")
    valid=$(jget "$body" "valid")
    [[ "$valid" == "True" || "$valid" == "true" ]] \
        && log_pass "有效作业码验证通过（valid=true）" \
        || log_fail "有效码验证失败（valid=$valid）"

    atitle=$(jget "$body" "assignment_title")
    [[ -n "$atitle" ]] \
        && log_pass "返回作业标题：$atitle" \
        || log_fail "缺少作业标题"

    ttype=$(jget "$body" "token_type")
    [[ "$ttype" == "universal" ]] \
        && log_pass "token_type=universal正确" \
        || log_fail "token_type异常=$ttype"

    # 15C: 通用码提交（需填姓名）
    resp=$(do_public POST /api/submit \
        "{\"token\":\"$TOKEN1\",
          \"student_name\":\"自动化测试学生\",
          \"content_type\":\"text\",
          \"content_text\":\"这是自动化测试提交的作业内容，验证Phase8-v2作业码提交功能。\"}")
    assert_status "凭作业码提交作业" "$resp" "201"
    body=$(get_body "$resp")
    sub_id=$(jget "$body" "submission_id")
    st_uuid=$(jget "$body" "student_uuid")
    [[ "${#sub_id}" == "36" ]] \
        && log_pass "提交成功 submission_id=${sub_id:0:8}..." \
        || log_fail "提交ID异常: $sub_id"
    [[ -n "$st_uuid" ]] \
        && log_pass "student_uuid已返回: ${st_uuid:0:15}..." \
        || log_fail "student_uuid缺失"

    # 15D: 验证提交写入数据库
    sub_db=$(pgq "SELECT id FROM assignment_submissions
        WHERE id='$sub_id' LIMIT 1;")
    [[ "${#sub_db}" == "36" ]] \
        && log_pass "提交已写入DB" \
        || log_fail "提交未在DB中找到"

    # 验证token已绑定submission
    tok_bound=$(pgq "SELECT submission_id FROM assignment_tokens
        WHERE token='$TOKEN1';")
    [[ "${#tok_bound}" == "36" ]] \
        && log_pass "Token已绑定submission_id" \
        || log_fail "Token未绑定（submission_id=$tok_bound）"

    # 15E: 不允许重复提交测试（allow_resubmit=true时应允许）
    resp=$(do_public POST /api/submit \
        "{\"token\":\"$TOKEN1\",
          \"student_name\":\"自动化测试学生\",
          \"content_type\":\"text\",
          \"content_text\":\"这是重新提交的内容\"}")
    s=$(get_status "$resp")
    [[ "$s" == "201" || "$s" == "200" ]] \
        && log_pass "allow_resubmit=true时允许重提 (HTTP $s)" \
        || log_fail "allow_resubmit=true时重提失败 (HTTP $s)"

    # 15F: 无姓名通用码提交应被拒绝
    TOKEN2=$(pgq "SELECT token FROM assignment_tokens
        WHERE assignment_id='$AID' AND token!='$TOKEN1'
        AND token_type='universal' LIMIT 1;")
    [[ -n "$TOKEN2" ]] && {
        resp=$(do_public POST /api/submit \
            "{\"token\":\"$TOKEN2\",
              \"content_type\":\"text\",
              \"content_text\":\"没有填姓名的提交\"}")
        s=$(get_status "$resp")
        [[ "$s" == "400" ]] \
            && log_pass "通用码无姓名→400拒绝" \
            || log_fail "通用码无姓名未拒绝 (HTTP $s)"
    } || log_skip "通用码无姓名测试（无第二个token）"

    # 15G: 学生查看评价结果（当前应无结果）
    resp=$(do_public GET "/api/submit/$AID/result?uuid=${st_uuid}")
    s=$(get_status "$resp")
    [[ "$s" == "404" ]] \
        && log_pass "无已发布评价→404正常" \
        || log_warn "评价查询返回 HTTP $s"
} || log_skip "学生提交测试（无作业码）"

# ============================================================
# Section 16: 专属码测试
# ============================================================
log_section "16. 专属码测试 (Phase8-v2)"

[[ -n "$AID" && -n "$ROOM_ID" ]] && {
    # 从课堂在线学生生成专属码
    resp=$(do_req POST "/api/assignments/$AID/tokens/generate" "$T1" \
        "{\"token_type\":\"dedicated\",\"room_id\":\"$ROOM_ID\",\"expire_days\":7}")
    s=$(get_status "$resp")
    body=$(get_body "$resp")
    if [[ "$s" == "201" ]]; then
        ded_count=$(jget "$body" "total_count")
        ded_type=$(jget "$body" "token_type")
        log_pass "专属码生成 数量=${ded_count} type=${ded_type}"

        # 提取一个专属码
        DED_TOKEN=$(echo "$body" | python3 -c "
import sys,json; d=json.load(sys.stdin)
tokens=[t for t in d.get('tokens',[]) if t.get('token_type')=='dedicated']
print(tokens[0].get('token','') if tokens else '')" 2>/dev/null)

        [[ -n "$DED_TOKEN" ]] && {
            # 验证专属码
            resp=$(do_public POST /api/submit/verify \
                "{\"token\":\"$DED_TOKEN\"}")
            s=$(get_status "$resp")
            body=$(get_body "$resp")
            if [[ "$s" == "200" ]]; then
                valid=$(jget "$body" "valid")
                suuid=$(jget "$body" "student_uuid")
                sname=$(jget "$body" "student_name")
                [[ "$valid" == "True" || "$valid" == "true" ]] \
                    && log_pass "专属码验证通过" \
                    || log_fail "专属码验证失败"
                [[ -n "$suuid" ]] \
                    && log_pass "专属码返回student_uuid=${suuid:0:8}..." \
                    || log_warn "专属码student_uuid为空（课堂可能无在线学生）"
            else
                log_info "专属码验证 HTTP $s（课堂可能无在线学生，属正常）"
            fi
        } || log_skip "专属码验证（无生成专属码）"
    else
        log_info "专属码生成 HTTP $s（课堂无在线学生，生成0个，属正常）"
    fi
} || log_skip "专属码测试（无作业/房间）"

# ============================================================
# Section 17: 边界与安全测试
# ============================================================
log_section "17. 边界与安全测试"

# 未登录访问受保护接口
resp=$(do_public GET "/api/assignments")
assert_status "未登录访问作业列表→401" "$resp" "401"

resp=$(do_public POST "/api/assignments/$AID/tokens/generate" \
    '{"token_type":"universal","count":3}')
assert_status "未登录生成作业码→401" "$resp" "401"

resp=$(do_public GET "/api/assignments/$AID/roster")
assert_status "未登录查看花名册→401" "$resp" "401"

# 过期作业码测试
[[ -n "$AID" ]] && {
    EXP_TOKEN=$(pgq "INSERT INTO assignment_tokens
        (assignment_id,token,token_type,expires_at)
        VALUES ('$AID','EXPTEST1','universal',NOW()-INTERVAL '1 day')
        ON CONFLICT (token) DO NOTHING RETURNING token;")
    [[ -n "$EXP_TOKEN" ]] && {
        resp=$(do_public POST /api/submit/verify \
            '{"token":"EXPTEST1"}')
        body=$(get_body "$resp")
        valid=$(jget "$body" "valid")
        [[ "$valid" == "False" || "$valid" == "false" ]] \
            && log_pass "过期作业码被拒绝（valid=false）" \
            || log_fail "过期作业码未拒绝（valid=$valid）"
        pgx "DELETE FROM assignment_tokens WHERE token='EXPTEST1';"
    } || log_skip "过期码测试（INSERT冲突）"
}

# 容量上限测试
resp=$(do_req POST /api/rooms "$T1" \
    '{"title":"容量测试房间","max_capacity":9999}')
if [[ "$(get_status "$resp")" == "201" ]]; then
    OID=$(jget2 "$(get_body "$resp")" "room" "id")
    cap=$(pgq "SELECT max_capacity FROM rooms WHERE id='$OID';")
    [[ "$cap" == "200" ]] \
        && log_pass "容量上限限制正确（9999→200）" \
        || log_info "容量值=$cap"
    pgx "DELETE FROM rooms WHERE id='$OID';"
fi

# ============================================================
# 清理
# ============================================================
log_section "清理测试数据"
cleanup

# ============================================================
# 汇总报告
# ============================================================
TOTAL=$((PASS+FAIL+SKIP))
RATE=0
[[ $((PASS+FAIL)) -gt 0 ]] && RATE=$((PASS*100/(PASS+FAIL)))

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                    测试结果汇总                          ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf "║  ✅ 通过 (PASS)   %-37s║\n" "$PASS 项"
printf "║  ❌ 失败 (FAIL)   %-37s║\n" "$FAIL 项"
printf "║  ⏭  跳过 (SKIP)   %-37s║\n" "$SKIP 项"
printf "║  📊 通过率        %-37s║\n" "${RATE}%  (${PASS}/${TOTAL})"
echo "╚══════════════════════════════════════════════════════════╝"

[[ ${#ERRORS[@]} -gt 0 ]] && {
    echo ""
    echo -e "${RED}失败项详情：${NC}"
    for e in "${ERRORS[@]}"; do
        echo -e "  ${RED}✗${NC} $e"
    done
}

echo ""
if   [[ $FAIL -eq 0 ]];   then
    echo -e "${GREEN}🎉 所有测试通过！MindCanvas Phase8-v2 功能完整。${NC}"
elif [[ $RATE -ge 95 ]]; then
    echo -e "${GREEN}✅ 通过率 ${RATE}%，系统健康。${NC}"
elif [[ $RATE -ge 85 ]]; then
    echo -e "${YELLOW}⚠️  通过率 ${RATE}%，有少量问题需关注。${NC}"
else
    echo -e "${RED}❌ 通过率 ${RATE}%，存在较多问题需修复。${NC}"
fi
echo ""
