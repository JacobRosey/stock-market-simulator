const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const API_ORIGIN = trimTrailingSlash(
    import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
);

export const API_BASE = `${API_ORIGIN}/api`;

export const SOCKET_URL = trimTrailingSlash(
    import.meta.env.VITE_SOCKET_URL || API_ORIGIN
);
