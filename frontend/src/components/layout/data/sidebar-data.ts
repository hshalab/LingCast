import {
  Clapperboard,
  Command,
  Images,
  ListChecks,
  RadioTower,
  Tv,
  Video,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: '数字人平台',
    email: 'talking-avatar@local',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: '数字人平台',
      logo: Command,
      plan: '数字人平台',
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
      title: '观众端',
      items: [
        {
          title: '直播间',
          url: '/rooms',
          icon: Tv,
        },
      ],
    },
  ],
}
