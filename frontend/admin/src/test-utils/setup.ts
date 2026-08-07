import '@/i18n'

// Deterministic language for tests: the admin UI defaults to Chinese, but the
// existing component tests assert English labels.
Object.defineProperty(window.navigator, 'language', {
  value: 'en-US',
  configurable: true,
})
