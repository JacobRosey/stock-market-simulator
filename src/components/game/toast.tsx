import { useEffect } from 'react';
import { useWebSocket } from '../../context/WebSocketContext';
import { isOrderFillUpdate } from '../../types';

import './toast.css';

export default function ToastMessages() {
    const { toast, clearToast } = useWebSocket();

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(clearToast, 4000);
        return () => clearTimeout(timer);
    }, [toast, clearToast]);

    if (!toast) return null;

    if (isOrderFillUpdate(toast) && toast.status === 'FILLED') {
        return (
            <div className="toast toast-success">
                Order filled for {toast.filledQuantity} {toast.ticker} at ${toast.filledPrice.toFixed(2)}.
                <button onClick={clearToast}>x</button>
            </div>
        );
    }

    if (isOrderFillUpdate(toast) && toast.status === 'PARTIALLY_FILLED') {
        return (
            <div className="toast toast-success">
                Order partially filled for {toast.filledQuantity} {toast.ticker} at ${toast.filledPrice.toFixed(2)}.
                <button onClick={clearToast}>x</button>
            </div>
        );
    }

    if (toast.status === 'REJECTED') {
        return (
            <div className="toast toast-fail">
                Order rejected: {toast.reason} ({toast.rejectedQuantity} unfilled {toast.ticker}).
                <button onClick={clearToast}>x</button>
            </div>
        );
    }

    return null;
}
