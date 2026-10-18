import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { apiBaseUrlProblem } from './src/lib/buildEnv.ts'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') {
    // Fail the build rather than ship a bundle that silently calls http://localhost:8000.
    const env = loadEnv(mode, import.meta.dirname, 'VITE_')
    const problem = apiBaseUrlProblem(env.VITE_API_BASE_URL, { hosted: Boolean(process.env.VERCEL) })
    if (problem?.level === 'error') throw new Error(problem.message)
    if (problem) console.warn(`[build] ${problem.message}`)
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, 'src') },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Measured on this suite: the slowest test is ~0.9s (2.2s for the 429 countdown, which waits out a real 2s
      // Retry-After). A starved machine (cold caches, antivirus scans, a busy CPU) slows jsdom + user-event
      // 10-20x, which blew through Vitest's 5s default on otherwise trivial tests. The budget is for stalls, not
      // slow tests: passing tests are unaffected and a genuine hang still fails.
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  }
})
