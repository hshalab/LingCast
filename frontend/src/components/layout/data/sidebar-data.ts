import {
  Clapperboard,
  Images,
  ListChecks,
  RadioTower,
  UsersRound,
  Video,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: '灵播 LingCast',
    email: 'talking-avatar@local',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: '灵播',
      logo: '/images/logo.svg',
      plan: '数字人直播平台',
    },
  ],
  navGroups: [
    {
      title: '数字人',
      items: [
        {
          title: '数字人列表',
          url: '/avatar-library',
          icon: Images,
        },
        {
          title: '数字人创建',
          url: '/avatar-studio',
          icon: Clapperboard,
        },
        {
          title: '播报制作',
          url: '/broadcast',
          icon: Video,
        },
        {
          title: '直播台',
          url: '/live-studio',
          icon: RadioTower,
        },
        {
          title: '任务中心',
          url: '/task-center',
          icon: ListChecks,
        },
      ],
    },
    {
      title: '用户相关',
      items: [
        {
          title: '用户列表',
          url: '/users',
          icon: UsersRound,
        },
      ],
    },
  ],
}
