import { createContext, useContext, useEffect, useState } from 'react'

type User = {
    user_id: string
    username: string
}

type AuthContextType = {
    isAuthenticated: boolean
    loading: boolean
    user: User | null
    login: (username: string, password: string) => Promise<void>
    logout: () => Promise<void>
    register: (username: string, password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

const API_URL = 'http://localhost:3000'

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [loading, setLoading] = useState(true)
    const [user, setUser] = useState<User | null>(null)

    // Check session on app load
    useEffect(() => {
        fetch('http://localhost:3000/auth/me', {
            credentials: 'include',
        })
            .then(async res => {
                const data = await res.json();
                console.log(`data received in auth context: ${JSON.stringify(data)}`)

                if (data.user) {
                    setUser(data.user);
                    setIsAuthenticated(true);
                } else {
                    setUser(null);
                    setIsAuthenticated(false);
                }
            })
            .catch(error => {
                console.error('Auth check error:', error);
            })
            .finally(() => setLoading(false));
    }, []);

    const login = async (username: string, password: string) => {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        })

        const data = await res.json()

        if (!res.ok) {
            throw new Error(data.error || 'Login failed')
        }


        console.log('Setting user to:', data.user);

        setUser(data.user)
        setIsAuthenticated(true)
    }

    const register = async (username: string, password: string) => {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        })

        const data = await res.json()

        if (!res.ok) {
            console.log(data.error)
            throw new Error(data.error || 'Registration failed')
        }

        setUser(data.user)
        setIsAuthenticated(true)
    }

    const logout = async () => {
        await fetch(`${API_URL}/auth/logout`, {
            method: 'POST',
            credentials: 'include',
        })
        setUser(null)
        setIsAuthenticated(false)
    }

    return (
        <AuthContext.Provider
            value={{
                isAuthenticated,
                loading,
                user,
                login,
                logout,
                register
            }}
        >
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider')
    }
    return context
}