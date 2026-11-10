import { Suspense, lazy } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Splash, RequireAuth, RequirePerm } from './components/Guards'
import { HealthGate } from './components/HealthGate'
import { Layout } from './components/Layout'
import { AuthProvider } from './lib/auth'
import AuthForm from './pages/AuthForm'
import Estado from './pages/Estado'

const Files = lazy(() => import('./pages/Files'))
const RefinePage = lazy(() => import('./pages/RefinePage'))

function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center bg-slate-950 text-slate-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="mt-2 text-slate-400">Esta página no existe.</p>
        <Link className="mt-4 inline-block underline" to="/files">
          Ir al inicio
        </Link>
      </div>
    </main>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <HealthGate>
        <AuthProvider>
          <Suspense fallback={<Splash />}>
            <Routes>
              <Route path="/login" element={<AuthForm mode="login" />} />
              <Route path="/register" element={<AuthForm mode="register" />} />
              <Route element={<RequireAuth />}>
                <Route element={<Layout />}>
                  <Route path="/" element={<Navigate to="/files" replace />} />
                  <Route path="/estado" element={<Estado />} />
                  <Route element={<RequirePerm perm="files:read" />}>
                    <Route path="/files" element={<Files />} />
                    <Route path="/files/:id/refine" element={<RefinePage />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </HealthGate>
    </ErrorBoundary>
  )
}
