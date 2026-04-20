import { Routes, Route } from 'react-router-dom'
import { usePipelineSSE } from '@/hooks/usePipelineSSE'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { LoginPage } from '@/pages/LoginPage'
import { ProtectedRoute } from '@/components/ProtectedRoute'

function App() {
  usePipelineSSE('/api/v1/events/stream')

  return (
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
  )
}

export default App
