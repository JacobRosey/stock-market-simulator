import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import {useNavigate} from 'react-router-dom'
import './auth.css'

export default function Register() {
    const { register } = useAuth()
    const navigate = useNavigate()

    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.SubmitEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            await register(username, password)
            navigate('/login')
        } catch (err) {
            setError(err instanceof Error ? err.message : "Registration failed")
            setLoading(false)
        }
    }

    return (
        <div className="auth-page">
            <form className="auth-card" onSubmit={handleSubmit}>
                <h1>Sign Up</h1>

                {error && <div className="error">{error}</div>}

                <label>
                    Username
                    <input
                        type="text"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        required
                    />
                </label>

                <label>
                    Password
                    <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                    />
                </label>

                <button type="submit" disabled={loading}>
                    {loading ? 'Registering...' : 'Register'}
                </button>
                <div className="other-link">
                    Already have an account? <a href="/login">Sign in</a>
                </div>
            </form>
        </div>
    )
}