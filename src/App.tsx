import { Routes, Route} from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { WebSocketProvider } from './context/WebSocketContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './components/auth/login'
import Register from './components/auth/register'
import Dashboard from './components/game/dashboard'
import Portfolio from './components/game/portfolio'
import Orders from './components/game/orders'
import ToastMessages from './components/game/toast'

function App() {
  const { loading } = useAuth()

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Protected */}
      <Route element={<ProtectedRoute />}>
        <Route element={<WebSocketProvider />}>
          <Route element={<ToastMessages />} />
          <Route path="/" element={<Dashboard />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/orders" element={<Orders />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default App