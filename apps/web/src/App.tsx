import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import FormPage from './pages/FormPage'
import NotFound from './pages/NotFound'
import Showcase from './pages/Showcase'

// The admin page pulls in supabase-js; keep it out of the public form's bundle.
const Admin = lazy(() => import('./pages/Admin'))

function App() {
  return (
    <Routes>
      <Route path="/" element={<Showcase />} />
      <Route path="/f/:slug" element={<FormPage />} />
      {/* The old gallery: every form now lives on the showcase at `/`. */}
      <Route path="/forms" element={<Navigate to="/" replace />} />
      <Route
        path="/admin"
        element={
          <Suspense fallback={<p className="p-6 text-sm text-stone-600">Loading…</p>}>
            <Admin />
          </Suspense>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default App
