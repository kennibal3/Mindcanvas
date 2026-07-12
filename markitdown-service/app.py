# =============================================================
# MindCanvas - MarkItDown 文件解析微服务
# 功能：将 PDF/Word/PPT/Excel/图片等文件转换为 Markdown 文本
# 端口：8081（仅监听 localhost，不对外暴露）
# =============================================================
import os
import io
import sys
import json
import time
import base64
import logging
import tempfile
import traceback
from pathlib import Path
from flask import Flask, request, jsonify
from markitdown import MarkItDown
import pypdfium2 as pdfium  # REQ-040 二期：扫描 PDF 逐页渲染

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# MarkItDown 实例（全局复用）
md_converter = MarkItDown()

# 支持的文件类型映射
SUPPORTED_MIME_TYPES = {
    # PDF
    'application/pdf': 'pdf',
    # Word
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    # PowerPoint
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.ms-powerpoint': 'ppt',
    # Excel
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
    # 图片
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    # 文本
    'text/plain': 'txt',
    'text/html': 'html',
    'text/csv': 'csv',
    # 其他
    'application/json': 'json',
    'application/xml': 'xml',
    'text/xml': 'xml',
}

# 文件大小限制：50MB
MAX_FILE_SIZE = 50 * 1024 * 1024

# REQ-040 二期：PDF 渲染参数
MAX_RENDER_PAGES = 10   # 最多渲染前 10 页（防超时防爆内存，2核1.6G）
RENDER_SCALE = 2.0      # A4@72dpi × 2 ≈ 1190×1684，OCR 分辨率足够
JPEG_QUALITY = 85


@app.route('/health', methods=['GET'])
def health():
    """健康检查"""
    return jsonify({
        'status': 'ok',
        'service': 'markitdown',
        'version': '0.1.6'
    })


@app.route('/parse/file', methods=['POST'])
def parse_file():
    """
    解析上传的文件
    请求：multipart/form-data，字段名 file
    返回：{success, markdown, word_count, char_count, elapsed_ms, error}
    """
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': '缺少 file 字段'}), 400

    f = request.files['file']
    if not f.filename:
        return jsonify({'success': False, 'error': '文件名为空'}), 400

    # 检查文件大小
    f.seek(0, 2)
    file_size = f.tell()
    f.seek(0)
    if file_size > MAX_FILE_SIZE:
        return jsonify({
            'success': False,
            'error': f'文件过大（{file_size // 1024 // 1024}MB），最大支持 50MB'
        }), 413

    # 获取文件扩展名
    original_name = f.filename
    ext = Path(original_name).suffix.lower()
    if not ext:
        ext = '.tmp'

    start_time = time.time()

    # 写入临时文件
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=ext,
            delete=False,
            dir='/tmp'
        ) as tmp:
            tmp_path = tmp.name
            f.save(tmp)

        logger.info(f'开始解析文件: {original_name} ({file_size} bytes) -> {tmp_path}')

        # 调用 MarkItDown 解析
        result = md_converter.convert(tmp_path)
        markdown_text = result.text_content or ''

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 统计词数（中英文混合简单统计）
        char_count = len(markdown_text)
        # 按空白符分词（英文），加上中文字符数估算
        words = len(markdown_text.split())

        logger.info(f'解析完成: {original_name} 字符数={char_count} 耗时={elapsed_ms}ms')

        return jsonify({
            'success': True,
            'markdown': markdown_text,
            'word_count': words,
            'char_count': char_count,
            'elapsed_ms': elapsed_ms,
            'original_name': original_name,
            'file_size': file_size,
        })

    except Exception as e:
        elapsed_ms = int((time.time() - start_time) * 1000)
        err_msg = str(e)
        logger.error(f'解析失败: {original_name} 错误={err_msg}')
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': err_msg,
            'elapsed_ms': elapsed_ms,
        }), 500

    finally:
        # 清理临时文件
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@app.route('/render/pdf-pages', methods=['POST'])
def render_pdf_pages():
    """
    REQ-040 二期：把 PDF 逐页渲染为 JPEG 图片（扫描件 OCR 的前置步骤）
    请求：multipart/form-data，字段名 file（PDF 文件）
    返回：{success, page_count, rendered_pages, pages: [base64...], elapsed_ms}
    说明：最多渲染前 MAX_RENDER_PAGES 页；OCR 由 Go 后端逐页调豆包完成，
          本服务只做渲染，不碰 AI。逐页渲染、渲染完即释放，控制内存峰值。
    """
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': '缺少 file 字段'}), 400

    f = request.files['file']
    if not f.filename:
        return jsonify({'success': False, 'error': '文件名为空'}), 400

    f.seek(0, 2)
    file_size = f.tell()
    f.seek(0)
    if file_size > MAX_FILE_SIZE:
        return jsonify({
            'success': False,
            'error': f'文件过大（{file_size // 1024 // 1024}MB），最大支持 50MB'
        }), 413

    start_time = time.time()
    tmp_path = None
    pdf = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False, dir='/tmp') as tmp:
            tmp_path = tmp.name
            f.save(tmp)

        pdf = pdfium.PdfDocument(tmp_path)
        page_count = len(pdf)
        if page_count == 0:
            return jsonify({'success': False, 'error': 'PDF 没有任何页面'}), 422

        n = min(page_count, MAX_RENDER_PAGES)
        logger.info(f'开始渲染 PDF: {f.filename} 共{page_count}页，渲染前{n}页')

        pages = []
        for i in range(n):
            page = pdf[i]
            bitmap = page.render(scale=RENDER_SCALE)
            pil_img = bitmap.to_pil().convert('RGB')
            buf = io.BytesIO()
            pil_img.save(buf, format='JPEG', quality=JPEG_QUALITY)
            pages.append(base64.b64encode(buf.getvalue()).decode('ascii'))
            page.close()

        elapsed_ms = int((time.time() - start_time) * 1000)
        logger.info(f'渲染完成: {f.filename} {n}页 耗时={elapsed_ms}ms')

        return jsonify({
            'success': True,
            'page_count': page_count,
            'rendered_pages': n,
            'pages': pages,
            'elapsed_ms': elapsed_ms,
        })

    except Exception as e:
        elapsed_ms = int((time.time() - start_time) * 1000)
        err_msg = str(e)
        logger.error(f'PDF 渲染失败: {f.filename} 错误={err_msg}')
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': err_msg,
            'elapsed_ms': elapsed_ms,
        }), 500

    finally:
        if pdf is not None:
            try:
                pdf.close()
            except Exception:
                pass
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@app.route('/parse/path', methods=['POST'])
def parse_path():
    """
    解析服务器本地文件路径（Go后端调用，避免二次传输大文件）
    请求：JSON {file_path: "/opt/mindcanvas/uploads/files/..."}
    返回：{success, markdown, word_count, char_count, elapsed_ms, error}
    安全：只允许解析 /opt/mindcanvas/uploads/ 目录下的文件
    """
    data = request.get_json()
    if not data or 'file_path' not in data:
        return jsonify({'success': False, 'error': '缺少 file_path 字段'}), 400

    file_path = data['file_path']

    # 安全校验：只允许访问 uploads 目录
    allowed_prefix = '/opt/mindcanvas/uploads/'
    real_path = os.path.realpath(file_path)
    if not real_path.startswith(os.path.realpath(allowed_prefix)):
        logger.warning(f'非法路径访问被拒绝: {file_path}')
        return jsonify({'success': False, 'error': '不允许访问该路径'}), 403

    if not os.path.exists(real_path):
        return jsonify({'success': False, 'error': '文件不存在'}), 404

    file_size = os.path.getsize(real_path)
    if file_size > MAX_FILE_SIZE:
        return jsonify({
            'success': False,
            'error': f'文件过大（{file_size // 1024 // 1024}MB），最大支持 50MB'
        }), 413

    start_time = time.time()

    try:
        logger.info(f'开始解析本地文件: {real_path} ({file_size} bytes)')

        result = md_converter.convert(real_path)
        markdown_text = result.text_content or ''

        elapsed_ms = int((time.time() - start_time) * 1000)
        char_count = len(markdown_text)
        words = len(markdown_text.split())

        logger.info(f'解析完成: {real_path} 字符数={char_count} 耗时={elapsed_ms}ms')

        return jsonify({
            'success': True,
            'markdown': markdown_text,
            'word_count': words,
            'char_count': char_count,
            'elapsed_ms': elapsed_ms,
            'file_path': real_path,
            'file_size': file_size,
        })

    except Exception as e:
        elapsed_ms = int((time.time() - start_time) * 1000)
        err_msg = str(e)
        logger.error(f'解析失败: {real_path} 错误={err_msg}')
        return jsonify({
            'success': False,
            'error': err_msg,
            'elapsed_ms': elapsed_ms,
        }), 500


@app.route('/parse/text', methods=['POST'])
def parse_text():
    """
    解析纯文本内容（学生提交的文字作业直接解析，无需文件）
    请求：JSON {text: "...", title: "可选标题"}
    返回：{success, markdown, word_count, char_count}
    """
    data = request.get_json()
    if not data or 'text' not in data:
        return jsonify({'success': False, 'error': '缺少 text 字段'}), 400

    raw_text = data.get('text', '')
    title = data.get('title', '')

    if not raw_text.strip():
        return jsonify({'success': False, 'error': '文本内容为空'}), 400

    # 文本直接作为 Markdown（加标题）
    markdown_text = f'# {title}\n\n{raw_text}' if title else raw_text
    char_count = len(markdown_text)
    words = len(markdown_text.split())

    return jsonify({
        'success': True,
        'markdown': markdown_text,
        'word_count': words,
        'char_count': char_count,
        'elapsed_ms': 0,
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8081))
    logger.info(f'MarkItDown 解析服务启动，监听端口 {port}')
    app.run(host='127.0.0.1', port=port, debug=False)
