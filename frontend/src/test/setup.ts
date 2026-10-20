import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// findBy*/waitFor default to 1s, which is thinner than the per-test budget under CPU starvation (see vite.config.ts).
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/') // routes live in the URL; every test starts on the dashboard
})

// jsdom lacks these browser APIs, which Recharts, Radix and the dashboard rely on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

Element.prototype.scrollIntoView ??= () => {}
// jsdom logs "not implemented" for window.scrollTo, which the router calls after an in-page navigation.
window.scrollTo = () => {}

// jsdom has no layout, so ResponsiveContainer would measure 0x0 and Recharts would draw nothing.
// Render the chart at a fixed size instead; everything else in Recharts stays real.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  const { cloneElement } = await import('react')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 480, height: 256 }),
  }
})
