import { execSync } from 'node:child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

function buildSha(mode: string): string {
  if (mode !== 'production') return 'dev'
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA
  if (fromEnv) return fromEnv.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  define: { __BUILD_SHA__: JSON.stringify(buildSha(mode)) },
}))
