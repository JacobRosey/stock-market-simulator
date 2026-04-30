import { useWebSocket } from '../../../context/WebSocketContext';
import { useAuth } from '../../../context/AuthContext';
import './leaderboard.css';

import type { LeaderboardEntry } from '../../../types'


interface LeaderboardProps {
    currentUsername?: string; // Pass the logged-in user's username
}

export default function Leaderboard({ currentUsername } : LeaderboardProps) {
    const { leaderboard } = useWebSocket();
    const { user } = useAuth();
    const activeUsername = currentUsername ?? user?.username;
    const topFive = leaderboard.slice(0, 5);
    const currentUserRank = activeUsername && !topFive.some(entry => entry.username === activeUsername)
        ? leaderboard.find((entry: LeaderboardEntry) => entry.username === activeUsername) ?? null
        : null;
    const lastPlace = leaderboard[leaderboard.length - 1] ?? null;
    const visibleUsernames = new Set([
        ...topFive.map(entry => entry.username),
        ...(currentUserRank ? [currentUserRank.username] : []),
    ]);
    const showLastPlace = lastPlace && !visibleUsernames.has(lastPlace.username);
    const loading = leaderboard.length === 0;

    const formatGain = (gain: number): string => {
        const sign = gain >= 0 ? '+' : '';
        return `${sign}${gain.toFixed(2)}%`;
    };

    const getLeaderboardName = (entry: LeaderboardEntry): string => {
        return entry.type === 'bot' ? entry.displayName ?? entry.username : entry.username;
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
                        className={`leaderboard-card ${entry.type} ${entry.username === activeUsername ? 'current-user' : ''}`}
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
                                {getLeaderboardName(entry)}
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
                                    {getLeaderboardName(currentUserRank)} (you)
                                </div>
                                <div className={`card-gain ${currentUserRank.gain >= 0 ? 'positive' : 'negative'}`}>
                                    {formatGain(currentUserRank.gain)}
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* Show if user not in top 5 and no currentUserRank (shouldn't happen, but just in case) */}
                {!currentUserRank && activeUsername && !topFive.some(entry => entry.username === activeUsername) && (
                    <div className="leaderboard-card outside-top not-placed">
                        <div className="card-info">
                            <div className="card-username">{activeUsername}</div>
                            <div className="not-placed-text">Not yet ranked</div>
                        </div>
                    </div>
                )}

                {showLastPlace && (
                    <>
                        <div className="leaderboard-separator last-place-separator">
                            <span className="separator-line"></span>
                            <span className="separator-text">last place</span>
                            <span className="separator-line"></span>
                        </div>

                        <div className={`leaderboard-card last-place ${lastPlace.type}`}>
                            <div className="card-rank">
                                #{lastPlace.rank}
                            </div>

                            <div className="card-avatar">
                                {getAvatar(lastPlace.type)}
                            </div>

                            <div className="card-info">
                                <div className="card-username">
                                    {getLeaderboardName(lastPlace)}
                                </div>
                                <div className={`card-gain ${lastPlace.gain >= 0 ? 'positive' : 'negative'}`}>
                                    {formatGain(lastPlace.gain)}
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
