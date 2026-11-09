import { Route, Routes } from 'react-router-dom'

function Home() {
  return (
    <main className="min-h-screen grid place-items-center bg-slate-900 text-slate-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Hola Lumon</h1>
        <p className="mt-2 text-slate-400">Build: {__BUILD_SHA__}</p>
      </div>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<p className="p-8">404</p>} />
    </Routes>
  )
}
