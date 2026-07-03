// =============================================================
// MindCanvas v3.0 - React 应用入口
// =============================================================
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './i18n';

// ⭐ 注册所有Widget组件（必须在App渲染之前）
import './registry/widgetRegister';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
