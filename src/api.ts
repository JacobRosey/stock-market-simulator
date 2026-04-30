import type { OrderRequestData, StocksResponse } from "./types";

const API_BASE = 'http://localhost:3000/api';

export const fetchStocks = async (): Promise<StocksResponse> => {
    try {
        const response = await fetch(`${API_BASE}/stocks`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const text = await response.text();
        if (!text) {
            return [];
        }

        return JSON.parse(text);
    } catch (error) {
        console.error('Failed to fetch stocks:', error);
        return [];
    }
};
export const fetchPriceHistory = async (ticker: string, range = '1d') => {
    try {
        const response = await fetch(`${API_BASE}/stocks/${ticker}/price-data?range=${range}`);
        if (!response.ok) {
            console.error(`Response not OK in fetchPriceHistory: `, response)
        }
        return response.json()
    }
    catch (error) {
        console.error(`Error in fetchPriceHistory: `, error)
        return []
    }
};

export const placeOrder = async (data: OrderRequestData) => {
    try {
        const response = await fetch(`${API_BASE}/place-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                console.log("Could not verify user");
                window.location.href = '/login';
                return;
            }

            // Not auth-related error: get the error message from response
            const errorData = await response.json();
            console.error('Server error:', errorData);
            throw new Error(errorData.error || 'Failed to place order');
        }

        const responseData = await response.json();
        console.log(responseData)
        return {...responseData, ...data};

    } catch (error) {
        console.error('Error placing order:', error);
        throw error;
    }
};

export const fetchPortfolio = async () => {
    try {
        const response = await fetch(`${API_BASE}/portfolio`, {
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                console.log("could not verify user")
                window.location.href = '/login';
                return;
            }
            // Not auth-related error: get the error message from response
            const errorData = await response.json();
            console.error('Server error:', errorData);
            throw new Error(errorData.error || 'Failed to fetch portfolio');
        }

        const responseData = await response.json();
        return responseData;

    } catch (error) {
        console.error('Error:', error);
    }
};

export const fetchLeaderboard = async () => {
    try {
        const response = await fetch(`${API_BASE}/leaderboard`, {
            credentials: 'include'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to fetch leaderboard');
        }

        return await response.json();
    } catch (error) {
        console.error('Error:', error);
        return [];
    }
};

export const getOrderData = async () => {
    try {
        const response = await fetch(`${API_BASE}/order-data`, {
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                console.log("could not verify user")
                window.location.href = '/login';
                return;
            }
            // Not auth-related error: get the error message from response
            const errorData = await response.json();
            console.error('Server error:', errorData);
            throw new Error(errorData.error || 'Failed to order data');
        }

        const responseData = await response.json();
        console.log("Order data: ", responseData)
        return responseData;

    } catch (error) {
        console.error('Error:', error);
    }
}

export const attemptOrderCancellation = async (id: Number, ticker: string, side: string) => {
    try {
        const response = await fetch(`${API_BASE}/cancel-order`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ id, ticker, side })
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                // Redirect to login
                console.log("could not verify user")
                window.location.href = '/login';
                return;
            }
            if (response.status == 400) {
                throw new Error('Missing required field: id, ticker, or side');
            }
        }

        const responseData = await response.json();
        return responseData;

    } catch (error) {
        console.error('Error:', error);
    }
}
