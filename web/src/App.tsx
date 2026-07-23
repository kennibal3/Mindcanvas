// =============================================================
// MindCanvas v4.1 - 应用路由总控
// Phase7新增：/share/:token 公开分享页（无需登录）
// Phase8新增：/assignments 作业评价中心
//             /assignments/:id 作业详情页
// Phase8-v2新增：/submit 学生作业提交页（无需登录）
// 路由规则：
//   /login              教师/管理员登录
//   /join               学生免注册入场
//   /join/:code         带邀请码的学生入场
//   /dashboard          教师仪表盘（需登录）
//   /room/:id           房间画布（教师通过Cookie，学生通过UUID）
//   /admin/*            管理后台（需 admin/superadmin）
//   /share/:token       公开只读分享页（无需登录）
//   /submit             学生作业提交页（无需登录，凭作业码）
//   /assignments        作业评价中心（需登录）
//   /assignments/:id    作业详情页（需登录）
// =============================================================
import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';

// 页面组件
import LoginPage            from '@/pages/LoginPage';
import JoinPage             from '@/pages/JoinPage';
import DashboardPage        from '@/pages/DashboardPage';
import RoomPage             from '@/pages/RoomPage';
import AdminPage            from '@/pages/AdminPage';
import SharePage            from '@/pages/SharePage';
import SubmitPage           from '@/pages/SubmitPage';
// Phase8：作业评价中心
import AssignmentPage       from '@/pages/AssignmentPage';
import AssignmentDetailPage from '@/pages/AssignmentDetailPage';
// REQ-045 P2：班级管理（实名上课花名册）
import ClassesPage          from '@/pages/ClassesPage';
// Chat养成对话页面（Victoria专属）
import ChatPage from '@/pages/ChatPage';

// ===== 受保护路由：需要教师/管理员登录 =====
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, loading } = useAuthStore();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="spinner" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// ===== 管理员路由：需要 superadmin 或 admin 角色 =====
const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, loading, user } = useAuthStore();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="spinner" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'superadmin' && user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

// ===== 应用根组件 =====
const App = () => {
  const { checkAuth } = useAuth();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        await checkAuth();
      } catch {
        // 未登录时忽略
      } finally {
        setInitialized(true);
      }
    };
    init();
  }, [checkAuth]);

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="spinner mx-auto mb-4" />
          <p className="text-sm text-gray-400">MindCanvas 加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* ===== 完全公开路由（无需任何认证）===== */}
      <Route path="/login"      element={<LoginPage />} />
      <Route path="/join"       element={<JoinPage />} />
      <Route path="/join/:code" element={<JoinPage />} />

      {/* Phase7：公开分享页 */}
      <Route path="/share/:token" element={<SharePage />} />

      {/* Phase8-v2：学生作业提交页（凭作业码，无需登录）*/}
      <Route path="/submit" element={<SubmitPage />} />

      {/* ===== Chat养成对话页面（仅chat_enabled用户，Victoria专属）===== */}
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />

      {/* ===== 房间页面（教师 Cookie 认证 + 学生 UUID）===== */}
      <Route path="/room/:id" element={<RoomPage />} />

      {/* ===== 需要教师/管理员登录的路由 ===== */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />

      {/* REQ-045 P2：班级管理（实名上课花名册）*/}
      <Route
        path="/classes"
        element={
          <ProtectedRoute>
            <ClassesPage />
          </ProtectedRoute>
        }
      />

      {/* Phase8：作业评价中心 */}
      <Route
        path="/assignments"
        element={
          <ProtectedRoute>
            <AssignmentPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/assignments/:id"
        element={
          <ProtectedRoute>
            <AssignmentDetailPage />
          </ProtectedRoute>
        }
      />

      {/* ===== 管理后台（需要 admin/superadmin）===== */}
      <Route
        path="/admin/*"
        element={
          <AdminRoute>
            <AdminPage />
          </AdminRoute>
        }
      />

      {/* ===== 默认重定向 ===== */}
      <Route path="*" element={<Navigate to="/join" replace />} />
    </Routes>
  );
};

export default App;
