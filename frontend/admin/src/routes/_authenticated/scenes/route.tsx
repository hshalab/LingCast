import { createFileRoute, Outlet } from '@tanstack/react-router'

// 场景目录布局：/scenes 列表 与 /scenes/add-video 添加页是同级路由，
// 由这里统一渲染 Outlet（列表页本身不渲染子路由）。
export const Route = createFileRoute('/_authenticated/scenes')({
  component: () => <Outlet />,
})
