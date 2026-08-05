export type EdgeVoice = {
  id: string
  label: string
}

// Static Edge-TTS voice catalog. Cached in localStorage to avoid redefining it
// on every visit; the default is a Chinese female voice (晓晓).
export const EDGE_TTS_VOICES: EdgeVoice[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女 · 普通话' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女 · 普通话' },
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男 · 普通话' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 男 · 普通话' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 男 · 新闻' },
  { id: 'zh-TW-HsiaoChenNeural', label: '曉臻 · 女 · 台湾腔' },
  { id: 'zh-HK-HiuMaanNeural', label: '曉曼 · 女 · 粤语' },
  { id: 'en-US-JennyNeural', label: 'Jenny · 女 · 美式英语' },
  { id: 'en-US-GuyNeural', label: 'Guy · 男 · 美式英语' },
  { id: 'ja-JP-NanamiNeural', label: 'Nanami · 女 · 日语' },
  { id: 'ko-KR-SunHiNeural', label: 'SunHi · 女 · 韩语' },
]

export const DEFAULT_VOICE_ID = 'zh-CN-XiaoxiaoNeural'

const VOICE_CACHE_KEY = 'edge_tts_voices_v1'

export function getCachedVoices(): EdgeVoice[] {
  try {
    const raw = window.localStorage.getItem(VOICE_CACHE_KEY)
    if (!raw) return EDGE_TTS_VOICES
    const parsed = JSON.parse(raw) as EdgeVoice[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : EDGE_TTS_VOICES
  } catch {
    return EDGE_TTS_VOICES
  }
}

export function cacheVoices(voices: EdgeVoice[]): void {
  try {
    window.localStorage.setItem(VOICE_CACHE_KEY, JSON.stringify(voices))
  } catch {
    // storage full / private mode: fall back to the static list
  }
}
