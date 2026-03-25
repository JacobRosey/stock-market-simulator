import { useState, useEffect } from 'react';
import { useWebSocket } from '../../../context/WebSocketContext';
import './leaderboard.css';

import type { LeaderboardEntry } from '../../../types'


interface LeaderboardProps {
    currentUsername?: string; // Pass the logged-in user's username
}

export default function Leaderboard({ currentUsername } : LeaderboardProps) {
    const [topFive, setTopFive] = useState<LeaderboardEntry[]>([]);
    const [currentUserRank, setCurrentUserRank] = useState<LeaderboardEntry | null>(null);
    const [loading, setLoading] = useState(true);
    //const { socket } = useWebSocket();

    // Fetch initial leaderboard data
    /*
    useEffect(() => {
        const fetchLeaderboard = async () => {
            try {
                const response = await fetch('/api/leaderboard');
                const data = await response.json();
                
                // Split into top 5 and current user if not in top 5
                const top = data.slice(0, 5);
                setTopFive(top);
                
                // Find current user
                const user = data.find((entry: LeaderboardEntry) => entry.username === currentUsername);
                if (user && !top.some(t => t.username === currentUsername)) {
                    setCurrentUserRank(user);
                }
            } catch (error) {
                console.error('Failed to fetch leaderboard:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchLeaderboard();
    }, [currentUsername]);

    // Listen for real-time leaderboard updates
    useEffect(() => {
        if (!socket) return;

        const handleLeaderboardUpdate = (data: any) => {
            const top = data.slice(0, 5);
            setTopFive(top);
            
            const user = data.find((entry: LeaderboardEntry) => entry.username === currentUsername);
            if (user && !top.some(t => t.username === currentUsername)) {
                setCurrentUserRank(user);
            } else {
                setCurrentUserRank(null);
            }
        };

        socket.on('LEADERBOARD_UPDATE', handleLeaderboardUpdate);

        return () => {
            socket.off('LEADERBOARD_UPDATE', handleLeaderboardUpdate);
        };
    }, [socket, currentUsername]);
    */
    const formatGain = (gain: number): string => {
        const sign = gain >= 0 ? '+' : '';
        return `${sign}${gain.toFixed(2)}%`;
    };

    const getAvatar = (type: 'human' | 'bot') => {
        return type === 'human' ? '👤' : '🤖';
    };

    if (loading) {
        return (
            <div className="leaderboard loading">
                <div className="leaderboard-header">
                    <h3>🏆 Leaderboard</h3>
                </div>
                <div className="loading-spinner">Loading rankings...</div>
            </div>
        );
    }

    return (
        <div className="leaderboard">
            <div className="leaderboard-header">
                <h3>🏆 Top Traders</h3>
                <span className="leaderboard-subtitle">by portfolio gain</span>
            </div>

            <div className="leaderboard-cards">
                {topFive.map((entry, index) => (
                    <div 
                        key={entry.username} 
                        className={`leaderboard-card ${entry.type} ${entry.username === currentUsername ? 'current-user' : ''}`}
                    >
                        <div className="card-rank">
                            {index === 0 && '🥇'}
                            {index === 1 && '🥈'}
                            {index === 2 && '🥉'}
                            {index > 2 && `#${entry.rank}`}
                        </div>
                        
                        <div className="card-avatar">
                            {getAvatar(entry.type)}
                        </div>
                        
                        <div className="card-info">
                            <div className="card-username">
                                {entry.username}
                                {entry.type === 'bot' && <span className="bot-tag">bot</span>}
                            </div>
                            <div className={`card-gain ${entry.gain >= 0 ? 'positive' : 'negative'}`}>
                                {formatGain(entry.gain)}
                            </div>
                        </div>
                    </div>
                ))}

                {/* Current user if not in top 5 */}
                {currentUserRank && (
                    <>
                        <div className="leaderboard-separator">
                            <span className="separator-line"></span>
                            <span className="separator-text">your rank</span>
                            <span className="separator-line"></span>
                        </div>

                        <div className="leaderboard-card current-user outside-top">
                            <div className="card-rank">
                                #{currentUserRank.rank}
                            </div>
                            
                            <div className="card-avatar">
                                {getAvatar(currentUserRank.type)}
                            </div>
                            
                            <div className="card-info">
                                <div className="card-username">
                                    {currentUserRank.username} (you)
                                </div>
                                <div className={`card-gain ${currentUserRank.gain >= 0 ? 'positive' : 'negative'}`}>
                                    {formatGain(currentUserRank.gain)}
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* Show if user not in top 5 and no currentUserRank (shouldn't happen, but just in case) */}
                {!currentUserRank && currentUsername && (
                    <div className="leaderboard-card outside-top not-placed">
                        <div className="card-info">
                            <div className="card-username">{currentUsername}</div>
                            <div className="not-placed-text">Not yet ranked</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};