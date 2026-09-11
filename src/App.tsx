import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Home } from './pages/Home'
import { Screen } from './components/Screen'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<Screen title="Page not found" />} />
      </Routes>
    </BrowserRouter>
  )
}
