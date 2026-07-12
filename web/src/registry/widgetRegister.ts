// =============================================================
// MindCanvas v4.1 - Widget 注册入口
// 启动时执行，将所有 Widget 组件注册到 WidgetRegistry
// =============================================================
import { WidgetRegistry } from './WidgetRegistry';
import PollingWidget from '@/components/widgets/PollingWidget';
import WordCloudWidget from '@/components/widgets/WordCloudWidget';
import QAWidget from '@/components/widgets/QAWidget';
import DropZoneWidget from '@/components/widgets/DropZoneWidget';
import ShelfWidget from '@/components/widgets/ShelfWidget';
import HtmlWidget from '@/components/widgets/HtmlWidget';

// 投票组件
WidgetRegistry.register('polling_widget', PollingWidget, {
  type: 'polling_widget',
  label: '投票',
  icon: '📊',
  description: '单选/多选投票，支持实时结果展示',
  category: 'interaction',
  defaultPayload: {
    question: '',
    options: ['选项A', '选项B'],
    mode: 'single',
    chart_type: 'bar',
    anonymous: false,
    showResult: true,
    show_result: true,
    allowChange: false,
    status: 'draft',
    votes: {},
    total_voters: 0,
  },
});

// 词云组件
WidgetRegistry.register('wordcloud_widget', WordCloudWidget, {
  type: 'wordcloud_widget',
  label: '词云',
  icon: '☁️',
  description: '学生提交关键词，实时词频可视化',
  category: 'interaction',
  defaultPayload: {
    prompt: '请输入关键词',
    words: {},
    status: 'draft',
    max_words_per_student: 3,
    anonymous: false,
  },
});

// 问答组件
WidgetRegistry.register('qa_widget', QAWidget, {
  type: 'qa_widget',
  label: '问答',
  icon: '❓',
  description: '单选题，支持正确答案判定和即时反馈',
  category: 'interaction',
  defaultPayload: {
    question: '',
    options: ['选项A', 'B', 'C', 'D'],
    correctIdx: 0,
    explanation: '',
    status: 'draft',
    showResult: false,
    showExplanation: false,
    stats: {},
  },
});

// ⭐ 作品收集区
// REQ-041：被 HTML 展示组件替代，insertable:false —— 仍注册以渲染存量房间里的旧组件，
// 但不再出现在教师插入工具栏（新建一律走 HTML 展示组件）。
WidgetRegistry.register('dropzone_widget', DropZoneWidget, {
  type: 'dropzone_widget',
  label: '作品收集',
  icon: '📥',
  description: '收集学生文字、图片、文件或链接作品',
  category: 'interaction',
  insertable: false,
  defaultPayload: {
    title: '作品收集',
    prompt: '请提交你的作品',
    acceptTypes: ['text', 'image'],
    maxFileSizeMB: 50,
    status: 'draft',
    submissionUnit: 'individual',
    maxPerStudent: 3,
    requireDescription: false,
    layout: 'grid',
    hideNames: false,
    enableLike: true,
    submissionOrder: [],
    submissionCount: 0,
  },
});
// 协作墙
WidgetRegistry.register('shelf_widget', ShelfWidget as any, {
  type: 'shelf_widget',
  label: '协作墙',
  icon: '🗂️',
  description: '分组栏目式协作墙，支持文字/图片/链接卡片实时贴板',
  category: 'interaction',
  defaultPayload: {
    title: '协作墙',
    status: 'open',
    visibility: 'open',
    allow_types: ['text', 'image', 'link'],
  },
});

// REQ-041 HTML 展示组件（改造/替代作品收集）
// 老师粘贴外部 AI 生成的 HTML 交互课件，在 iframe sandbox=allow-scripts 中渲染。
// 源码不进 payload（走 REST 落库引用），payload 仅存标题。
WidgetRegistry.register('html_widget', HtmlWidget as any, {
  type: 'html_widget',
  label: 'HTML 展示',
  icon: '🖥️',
  description: '粘贴 HTML 代码，在画布上渲染交互式课件（沙箱隔离）',
  category: 'interaction',
  insertable: true,
  defaultPayload: {
    title: 'HTML 展示',
  },
});
