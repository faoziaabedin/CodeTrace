/**
 * CodeTrace Session Timeline - Webview Script
 * 
 * This script handles the webview functionality:
 * - Receiving session data from the extension
 * - Rendering session cards
 * - Handling user interactions
 */

// VS Code API for communicating with the extension
const vscode = acquireVsCodeApi();

// Store sessions data
let sessions = [];

/**
 * Initialize the webview
 */
function init() {
    // Listen for messages from the extension
    window.addEventListener('message', handleMessage);
    
    // Request initial data
    vscode.postMessage({ command: 'refresh' });
}

/**
 * Handle messages from the extension
 */
function handleMessage(event) {
    const message = event.data;
    
    switch (message.command) {
        case 'loadSessions':
            sessions = message.sessions;
            renderSessions();
            break;
        case 'error':
            showError(message.message);
            break;
    }
}

/**
 * Render all sessions
 */
function renderSessions() {
    const container = document.getElementById('session-list');
    const summaryContainer = document.getElementById('stats-summary');
    
    if (sessions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">📭</div>
                <h2>No Sessions Found</h2>
                <p>Start recording your coding sessions to see them here. Use the command palette to run "CodeTrace: Start Recording".</p>
            </div>
        `;
        summaryContainer.innerHTML = '';
        return;
    }
    
    // Calculate summary stats
    const totalSessions = sessions.length;
    const totalFiles = sessions.reduce((sum, s) => sum + (s.stats?.filesChanged || s.changes?.length || 0), 0);
    const totalCommits = sessions.reduce((sum, s) => sum + (s.commits?.length || 0), 0);
    const totalMinutes = sessions.reduce((sum, s) => sum + (parseInt(s.stats?.duration) || 0), 0);
    
    // Render summary
    summaryContainer.innerHTML = `
        <div class="stat-card">
            <div class="value">${totalSessions}</div>
            <div class="label">Total Sessions</div>
        </div>
        <div class="stat-card">
            <div class="value">${totalFiles}</div>
            <div class="label">Files Changed</div>
        </div>
        <div class="stat-card">
            <div class="value">${totalCommits}</div>
            <div class="label">Commits</div>
        </div>
        <div class="stat-card">
            <div class="value">${totalMinutes}</div>
            <div class="label">Total Minutes</div>
        </div>
    `;
    
    // Render session cards
    container.innerHTML = sessions.map((session, index) => renderSessionCard(session, index)).join('');
}

/**
 * Render a single session card
 */
function renderSessionCard(session, index) {
    const startDate = new Date(session.startTime);
    const endDate = session.endTime ? new Date(session.endTime) : null;
    const isActive = !session.endTime;
    
    // Format dates nicely
    const formattedDate = formatDate(startDate);
    const formattedTime = formatTime(startDate);
    
    // Calculate duration
    const duration = session.stats?.duration || calculateDuration(session.startTime, session.endTime || new Date().toISOString());
    
    // Get stats
    const filesChanged = session.stats?.filesChanged || session.changes?.length || 0;
    const commitsCount = session.commits?.length || 0;
    const totalSaves = session.changes?.length || 0;
    
    return `
        <div class="session-card ${isActive ? 'active' : ''}">
            <div class="timeline-dot"></div>
            
            <div class="session-header">
                <div>
                    <div class="session-title">${formattedDate}</div>
                    <div class="session-id">ID: ${session.sessionId.substring(0, 8)}... • Started ${formattedTime}</div>
                </div>
                <span class="session-status ${isActive ? 'active' : 'completed'}">
                    ${isActive ? '● Recording' : 'Completed'}
                </span>
            </div>
            
            ${session.repository ? `
                <div class="repo-badge">
                    <span>📁</span>
                    <span>${session.repository}</span>
                </div>
            ` : ''}
            
            <div class="session-stats">
                <div class="session-stat">
                    <div class="value">${duration}</div>
                    <div class="label">Minutes</div>
                </div>
                <div class="session-stat">
                    <div class="value">${filesChanged}</div>
                    <div class="label">Files</div>
                </div>
                <div class="session-stat">
                    <div class="value">${totalSaves}</div>
                    <div class="label">Saves</div>
                </div>
                <div class="session-stat">
                    <div class="value">${commitsCount}</div>
                    <div class="label">Commits</div>
                </div>
            </div>
            
            <div class="session-actions">
                <button class="btn btn-primary" onclick="loadSession(${index})">
                    📂 Load Session
                </button>
                <button class="btn btn-secondary" onclick="viewDetails(${index})">
                    📋 View Details
                </button>
            </div>
        </div>
    `;
}

/**
 * Format date nicely
 */
function formatDate(date) {
    const options = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    };
    return date.toLocaleDateString(undefined, options);
}

/**
 * Format time nicely
 */
function formatTime(date) {
    return date.toLocaleTimeString(undefined, { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

/**
 * Calculate duration between two ISO timestamps
 */
function calculateDuration(startTime, endTime) {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const durationMs = end - start;
    return Math.round(durationMs / 60000);
}

/**
 * Handle Load Session button click
 */
function loadSession(index) {
    const session = sessions[index];
    vscode.postMessage({ 
        command: 'loadSession', 
        sessionId: session.sessionId 
    });
}

/**
 * Handle View Details button click
 */
function viewDetails(index) {
    const session = sessions[index];
    vscode.postMessage({ 
        command: 'viewDetails', 
        sessionId: session.sessionId 
    });
}

/**
 * Handle Refresh button click
 */
function refresh() {
    const container = document.getElementById('session-list');
    container.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <p>Loading sessions...</p>
        </div>
    `;
    vscode.postMessage({ command: 'refresh' });
}

/**
 * Show error message
 */
function showError(message) {
    const container = document.getElementById('session-list');
    container.innerHTML = `
        <div class="empty-state">
            <div class="icon">⚠️</div>
            <h2>Error Loading Sessions</h2>
            <p>${message}</p>
        </div>
    `;
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);

