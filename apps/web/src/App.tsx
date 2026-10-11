import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import FormPage from './pages/FormPage'
import FormsGallery from './pages/FormsGallery'
import NotFound from './pages/NotFound'

// The admin page pulls in supabase-js; keep it out of the public form's bundle.
const Admin = lazy(() => import('./pages/Admin'))

function App() {
  return (
    <Routes>
      <Route path="/" element={<FormPage />} />
      <Route path="/f/:slug" element={<FormPage />} />
      <Route path="/forms" element={<FormsGallery />} />
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
