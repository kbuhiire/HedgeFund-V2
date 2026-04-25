import { Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { usePipelineSSE } from '@/hooks/usePipelineSSE'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { LoginPage } from '@/pages/LoginPage'
import { ProtectedRoute } from '@/components/ProtectedRoute'

function App() {
  usePipelineSSE('/api/v1/events/stream')

  return (
    <>
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: { background: '#18181b', border: '1px solid #27272a', color: '#f4f4f5' },
        }}
      />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  )
}

export default App
