'use client'

import type { Scene } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

/**
 * SceneSwitcher — horizontal scrollable chip list overlaying the 9:16 video.
 * Lets the audience switch the avatar's active scene for 1v1 chats; the
 * parent calls the switch API and shows loading/feedback state.
 */
export default function SceneSwitcher({
  scenes,
  activeSceneId,
  switchingSceneId,
  onSwitch,
}: {
  scenes: Scene[]
  activeSceneId: number
  switchingSceneId: number | null
  onSwitch: (sceneId: number) => void
}) {
  const { t } = useI18n()
  if (scenes.length <= 1) return null

  return (
    <div className='absolute inset-x-0 bottom-16 z-20 flex justify-center px-3 lg:bottom-6'>
      <div className='flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full border border-white/15 bg-black/50 p-1 backdrop-blur'>
        {scenes.map((scene) => {
          const active = scene.id === activeSceneId
          const switching = switchingSceneId === scene.id
          return (
            <button
              key={scene.id}
              type='button'
              disabled={switchingSceneId !== null || active}
              onClick={() => onSwitch(scene.id)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs transition disabled:cursor-default ${
                active
                  ? 'bg-gradient-to-r from-blue-600 to-violet-600 font-medium text-white'
                  : 'text-white/85 hover:bg-white/10'
              } ${switching ? 'opacity-60' : ''}`}
            >
              {switching ? t('room.switching') : scene.title}
            </button>
          )
        })}
      </div>
    </div>
  )
}
