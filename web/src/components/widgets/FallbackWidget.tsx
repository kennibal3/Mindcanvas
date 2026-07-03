// =============================================================
// MindCanvas v3.0 - 降级组件
// 当 Widget 类型未在 WidgetRegistry 中注册时显示
// 提供友好的提示信息，避免白屏
// =============================================================
import React from 'react';
import { AlertCircle } from 'lucide-react';
import type { WidgetProps } from '@/types/widget';

/**
 * 降级组件
 * 所有未注册的 Widget 类型会渲染此组件
 */
const FallbackWidget: React.FC<WidgetProps> = ({ id, payload }) => {
  return (
    <div
      className="fallback-widget"
      style={{
        background: '#FFFFFF',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        border: '1px dashed #D1D5DB',
        padding: '16px',
        textAlign: 'center',
        width: '100%',
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
      }}
    >
      {/* 图标 */}
      <AlertCircle size={24} className="text-gray-400" />

      {/* 提示文字 */}
      <div className="text-sm text-gray-500">
        此组件类型暂不支持
      </div>

      {/* 类型信息（调试用） */}
      <div className="text-xs text-gray-300">
        ID: {id.slice(0, 8)}...
      </div>
    </div>
  );
};

export default FallbackWidget;
