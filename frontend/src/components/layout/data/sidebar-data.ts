import {
  Clapperboard,
  Command,
  Images,
  ListChecks,
  RadioTower,
  Video,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Talking Avatar',
    email: 'talking-avatar@local',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: 'Talking Avatar',
      logo: Command,
      plan: '数字人平台',
    },
  ],
  navGroups: [
    {
      title: 'Talking Avatar',
      items: [
        {
          title: 'Avatar Library',
          url: '/avatar-library',
          icon: Images,
        },
        {
          title: 'Avatar Studio',
          url: '/avatar-studio',
          icon: Clapperboard,
        },
        {
          title: '播报制作',
          url: '/broadcast',
          icon: Video,
        },
        {
          title: 'Live Studio',
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
  ],
}
