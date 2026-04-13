import { useEffect } from 'react';
import { useWebSocket } from '../../context/WebSocketContext';

import './toast.css'

export default function ToastMessages() {
    const { toast, clearToast } = useWebSocket();

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(clearToast, 4000);
        return () => clearTimeout(timer);
    }, [toast]);

    console.log("toast data in toast.tsx:", toast)

    if (!toast) return null;
    
    // for filled: remember it may have been a partial fill previously so filledQuantity won't necessarily be accurate for the whole order quantity 
    // since filledQuantity is only the number of fills per this trade, not overall, I can't easily figure out the original order amount from websocket comm

    if (toast.status === "FILLED") {
        return (
        <div className="toast toast-success">
            Order filled for {toast.filledQuantity} {toast.ticker} at ${toast.filledPrice.toFixed(2)}! 

            <button onClick={clearToast}>✕</button>
        </div>
        )
    } 
    
    // I want to say (11/15) or something like that to show fill progress, but need to get more data from websocket
    else if (toast.status === "PARTIALLY_FILLED") {
        return (
           <div className="toast toast-success">
            Order partially filled for {toast.ticker} at ${toast.filledPrice}! 

            <button onClick={clearToast}>✕</button>
        </div>
        )
    } 

     else if (toast.status === "CANCELLED") {
        return (
            <div className="toast toast-success">
                something bad happened (cancellation didn't work, order rejected, etc)
                <button onClick={clearToast}>✕</button>
            </div>
        )
    } 

     else if (toast.status === "REJECTED") {
        return (
            <div className="toast toast-fail">
                something bad happened (cancellation didn't work, order rejected, etc)
                <button onClick={clearToast}>✕</button>
            </div>
        )
    } 
      
};