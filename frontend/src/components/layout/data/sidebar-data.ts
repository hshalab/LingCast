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
      plan: 'nav.brandPlan',
    },
  ],
  navGroups: [
    {
      title: 'nav.groupAvatars',
      items: [
        {
          title: 'nav.avatarList',
          url: '/avatar-library',
          icon: Images,
        },
        {
          title: 'nav.avatarCreate',
          url: '/avatar-studio',
          icon: Clapperboard,
        },
        {
          title: 'nav.broadcast',
          url: '/broadcast',
          icon: Video,
        },
        {
          title: 'nav.liveStudio',
          url: '/live-studio',
          icon: RadioTower,
        },
        {
          title: 'nav.taskCenter',
          url: '/task-center',
          icon: ListChecks,
        },
      ],
    },
    {
      title: 'nav.groupUsers',
      items: [
        {
          title: 'nav.userList',
          url: '/users',
          icon: UsersRound,
        },
      ],
    },
  ],
}
