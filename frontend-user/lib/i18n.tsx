'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export const LANG_KEY = 'lingcast-lang'

export type Lang = 'zh' | 'en'

const zh = {
  common: {
    loading: '加载中…',
    cancel: '取消',
    confirm: '确定',
    processing: '处理中…',
  },
  nav: {
    slogan: '数字人直播',
    guest: '游客',
    account: '账号',
    register: '注册',
    login: '登录',
    logout: '退出',
    getIdentity: '获取游客身份',
    gettingIdentity: '获取身份中…',
    switchLight: '切换到亮色',
    switchDark: '切换到暗色',
    accountCenter: '用户中心',
    profile: '个人中心',
    logoutConfirm: '确定要退出登录吗？退出后本机游客身份将刷新。',
  },
  home: {
    liveNow: '正在开播',
    heroDesc: '进入房间观看直播、发消息互动，数字人会通过 AI 实时回复你。',
    liveCount: '开播中 {{count}} 个',
    categoryCount: '分类 {{count}} 种',
    emptyAll: '暂无开播的数字人',
    emptyCategory: '「{{category}}」分类暂无开播',
    emptyHint: '管理员在后台开启直播后，会出现在这里。',
    live: '直播中',
    age: '{{age}}岁',
    footer: '灵播 · AI 数字人直播平台',
    enterRoom: '进入直播间',
  },
  category: {
    all: '全部',
    chat: '闲聊',
    knowledge: '知识',
    entertainment: '娱乐',
    game: '游戏',
    sales: '带货',
    other: '其他',
  },
  room: {
    back: '返回列表',
    title: '直播间',
    mobileTitle: '直播间 #{{id}}',
    ageLabel: '年龄',
    ageValue: '{{age}}岁',
    heightLabel: '身高',
    heightValue: '{{height}}cm',
    weightLabel: '体重',
    weightValue: '{{weight}}kg',
    ethnicityLabel: '族裔',
    relationshipLabel: '感情',
    personalityLabel: '性格',
    notStarted: '主播暂未开播，请稍候…',
    live: '直播中',
    like: '点赞',
    placeholderIdentity: '发条消息…',
    placeholderGuest: '获取身份后即可发言',
    sending: '发送中…',
    send: '发送',
    chatTitle: '互动聊天',
    chatDesc: '数字人通过 AI 回复并开口说话',
    newMessages: '有新消息',
    chatEmpty: '还没有消息，说点什么吧',
    sendFailed: '发送失败',
    system: '系统',
  },
  auth: {
    registerTitle: '注册账号',
    loginTitle: '登录账号',
    registerDesc: '注册后当前身份的聊天记录将保留并绑定到该账号。',
    loginDesc: '登录后当前身份的聊天记录会合并进该账号，不会丢失。',
    usernamePlaceholder: '用户名',
    passwordPlaceholder: '密码（至少 4 位）',
    busy: '处理中…',
    register: '注册',
    login: '登录',
    failed: '操作失败',
  },
  identity: {
    notReady: '身份未就绪，请稍后重试',
  },
  account: {
    title: '用户中心',
    guestBadge: '游客',
    accountBadge: '账号',
    guestDesc: '当前是游客身份，聊天记录保存在本机；注册后可跨设备保留。',
    accountDesc: '已登录账号，聊天记录跟随账号。',
    register: '注册账号',
    login: '登录',
    logout: '退出登录',
    myMessages: '我的消息',
    noMessages: '还没有聊天记录，去直播间说两句吧',
    goHome: '去逛逛直播间',
  },
}

const en: typeof zh = {
  common: {
    loading: 'Loading…',
    cancel: 'Cancel',
    confirm: 'Confirm',
    processing: 'Processing…',
  },
  nav: {
    slogan: 'AI Digital Human Live',
    guest: 'Guest',
    account: 'Account',
    register: 'Register',
    login: 'Log in',
    logout: 'Log out',
    getIdentity: 'Get guest identity',
    gettingIdentity: 'Getting identity…',
    switchLight: 'Switch to light',
    switchDark: 'Switch to dark',
    accountCenter: 'Account Center',
    profile: 'Profile',
    logoutConfirm:
      'Are you sure you want to sign out? A new guest identity will be issued.',
  },
  home: {
    liveNow: 'Live Now',
    heroDesc:
      'Enter a room to watch the stream and chat; the digital human replies to you in real time with AI.',
    liveCount: '{{count}} live',
    categoryCount: '{{count}} categories',
    emptyAll: 'No digital humans are live',
    emptyCategory: 'Nothing live in "{{category}}"',
    emptyHint: 'Live rooms appear here once an admin starts them.',
    live: 'LIVE',
    age: 'Age {{age}}',
    footer: 'LingCast · AI Digital Human Live Platform',
    enterRoom: 'Enter live room',
  },
  category: {
    all: 'All',
    chat: 'Chat',
    knowledge: 'Knowledge',
    entertainment: 'Entertainment',
    game: 'Game',
    sales: 'Sales',
    other: 'Other',
  },
  room: {
    back: 'Back to list',
    title: 'Live Room',
    mobileTitle: 'Live Room #{{id}}',
    ageLabel: 'Age',
    ageValue: '{{age}} yrs',
    heightLabel: 'Height',
    heightValue: '{{height}}cm',
    weightLabel: 'Weight',
    weightValue: '{{weight}}kg',
    ethnicityLabel: 'Ethnicity',
    relationshipLabel: 'Relationship',
    personalityLabel: 'Personality',
    notStarted: "The host hasn't started yet, please wait…",
    live: 'LIVE',
    like: 'Like',
    placeholderIdentity: 'Type a message…',
    placeholderGuest: 'Get an identity to chat',
    sending: 'Sending…',
    send: 'Send',
    chatTitle: 'Live Chat',
    chatDesc: 'The digital human replies via AI and speaks aloud',
    newMessages: 'New messages',
    chatEmpty: 'No messages yet — say something!',
    sendFailed: 'Failed to send',
    system: 'System',
  },
  auth: {
    registerTitle: 'Create account',
    loginTitle: 'Sign in',
    registerDesc:
      "Registering keeps your current identity's chat history and binds it to this account.",
    loginDesc:
      "After sign-in, your current identity's chat history merges into this account — nothing is lost.",
    usernamePlaceholder: 'Username',
    passwordPlaceholder: 'Password (min 4 characters)',
    busy: 'Processing…',
    register: 'Register',
    login: 'Sign in',
    failed: 'Operation failed',
  },
  identity: {
    notReady: 'Identity not ready, please retry later',
  },
  account: {
    title: 'Account Center',
    guestBadge: 'Guest',
    accountBadge: 'Account',
    guestDesc:
      'You are browsing as a guest — chat history is stored locally. Register to keep it across devices.',
    accountDesc: 'Signed in as an account; chat history follows your account.',
    register: 'Create account',
    login: 'Sign in',
    logout: 'Sign out',
    myMessages: 'My messages',
    noMessages: 'No chat history yet — say something in a live room!',
    goHome: 'Browse live rooms',
  },
}

type Dict = typeof zh

function getInitialLang(): Lang {
  if (typeof window === 'undefined') return 'zh'
  const saved = window.localStorage.getItem(LANG_KEY)
  if (saved === 'zh' || saved === 'en') return saved
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function lookup(dict: Dict, path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], dict)
  return typeof value === 'string' ? value : path
}

type I18nContextValue = {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: string, vars?: Record<string, string | number>) => string
  locale: string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang)

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      window.localStorage.setItem(LANG_KEY, next)
    } catch {
      // private mode / storage full: ignore
    }
  }, [])

  useEffect(() => {
    try {
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    } catch {
      // document unavailable (SSR): ignore
    }
  }, [lang])

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let text = lookup(lang === 'zh' ? zh : en, key)
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{{${name}}}`, String(value))
        }
      }
      return text
    },
    [lang],
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t,
      locale: lang === 'zh' ? 'zh-CN' : 'en-US',
    }),
    [lang, setLang, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
