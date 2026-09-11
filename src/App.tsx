import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Home } from './pages/Home'
import { Volunteer } from './pages/Volunteer'
import { Screen } from './components/Screen'

// The volunteer screen is the one loaded on a bad connection by a lot of phones
// at once, so the setup and printing code is not part of its download.
const AdminHome = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminHome })))
const AdminEvent = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminEvent })))
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const Print = lazy(() => import('./pages/Print').then((m) => ({ default: m.Print })))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Screen title="Loading…" />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/admin" element={<AdminHome />} />
          <Route path="/admin/:eventId" element={<AdminEvent />} />
          <Route path="/count/:eventId/:token" element={<Volunteer />} />
          <Route path="/dash/:eventId" element={<Dashboard />} />
          <Route path="/print/:eventId" element={<Print />} />
          <Route path="*" element={<Screen title="Page not found" />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
