/**
 * CodeTrace Session Timeline - Enhanced Webview Script
 * 
 * Features:
 * - Session list view with cards
 * - Detailed timeline visualization with SVG
 * - File changes as circles, commits as diamonds
 * - Interactive tooltips and modal details
 * - Message passing with extension
 */

// VS Code API for communicating with the extension
const vscode = acquireVsCodeApi();

// Store sessions data
let sessions = [];
let currentSession = null;
let currentView = 'list'; // 'list' or 'detail'

// File type color mapping
const fileTypeColors = {
    'ts': '#3178c6',
    'tsx': '#3178c6',
    'js': '#f7df1e',
    'jsx': '#f7df1e',
    'json': '#cb8742',
    'css': '#264de4',
    'scss': '#cc6699',
    'html': '#e34c26',
    'md': '#083fa1',
    'py': '#3776ab',
    'go': '#00add8',
    'rs': '#dea584',
    'java': '#b07219',
    'default': '#6b7280'
};

/**
 * Initialize the webview
 */
function init() {
    // Listen for messages from the extension
    window.addEventListener('message', handleMessage);
    
    // Request initial data
    vscode.postMessage({ command: 'refresh' });
    
    // Setup modal close on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });
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
        case 'sessionLoaded':
            currentSession = message.session;
            showDetailView(message.session);
            break;
        case 'error':
            showError(message.message);
            break;
    }
}

/**
 * Render all sessions in list view
 */
function renderSessions() {
    const container = document.getElementById('session-list');
    const summaryContainer = document.getElementById('stats-summary');
    
    // Hide detail view, show list view
    document.getElementById('list-view').style.display = 'block';
    document.getElementById('detail-view').classList.remove('visible');
    currentView = 'list';
    
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
    const isActive = !session.endTime;
    
    const formattedDate = formatDate(startDate);
    const formattedTime = formatTime(startDate);
    const duration = session.stats?.duration || calculateDuration(session.startTime, session.endTime || new Date().toISOString());
    const filesChanged = session.stats?.filesChanged || session.changes?.length || 0;
    const commitsCount = session.commits?.length || 0;
    const totalSaves = session.changes?.length || 0;
    
    return `
        <div class="session-card ${isActive ? 'active' : ''}" onclick="loadSession('${session.sessionId}')">
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
        </div>
    `;
}

/**
 * Load a specific session and show detail view
 */
function loadSession(sessionId) {
    const session = sessions.find(s => s.sessionId === sessionId);
    if (session) {
        currentSession = session;
        showDetailView(session);
        // Notify extension
        vscode.postMessage({ command: 'loadSession', sessionId: sessionId });
    }
}

/**
 * Show the detailed timeline view for a session
 */
function showDetailView(session) {
    currentView = 'detail';
    
    // Hide list view
    document.getElementById('list-view').style.display = 'none';
    
    // Show and populate detail view
    const detailView = document.getElementById('detail-view');
    detailView.classList.add('visible');
    
    const startDate = new Date(session.startTime);
    const endDate = session.endTime ? new Date(session.endTime) : new Date();
    const duration = session.stats?.duration || calculateDuration(session.startTime, session.endTime || new Date().toISOString());
    
    detailView.innerHTML = `
        <button class="btn btn-secondary back-button" onclick="backToList()">
            ← Back to Sessions
        </button>
        
        <div class="session-detail-header">
            <div class="session-detail-title">${formatDate(startDate)}</div>
            <div class="session-detail-meta">
                <span>🕐 ${formatTime(startDate)} - ${session.endTime ? formatTime(endDate) : 'Now'}</span>
                <span>⏱️ ${duration} minutes</span>
                <span>📁 ${session.changes?.length || 0} saves</span>
                <span>📝 ${session.commits?.length || 0} commits</span>
                ${session.repository ? `<span>🗂️ ${session.repository}</span>` : ''}
            </div>
        </div>
        
        <div class="timeline-container">
            <div class="timeline-header">
                <div class="timeline-title">Activity Timeline</div>
                <div class="timeline-legend">
                    <div class="legend-item">
                        <div class="legend-dot" style="background: var(--vscode-textLink-foreground);"></div>
                        <span>File Save</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-diamond"></div>
                        <span>Commit</span>
                    </div>
                </div>
            </div>
            <div class="timeline-svg-container" id="timeline-svg-container">
                ${renderTimelineSVG(session)}
            </div>
        </div>
        
        <div class="changes-list">
            <div class="changes-list-header">
                📋 All Changes (${(session.changes?.length || 0) + (session.commits?.length || 0)})
            </div>
            ${renderChangesList(session)}
        </div>
    `;
    
    // Setup tooltip handlers
    setupTimelineInteractions();
}

/**
 * Render SVG timeline visualization
 */
function renderTimelineSVG(session) {
    const changes = session.changes || [];
    const commits = session.commits || [];
    
    if (changes.length === 0 && commits.length === 0) {
        return '<div class="empty-state"><p>No activity recorded in this session</p></div>';
    }
    
    // Combine and sort all events by timestamp
    const allEvents = [
        ...changes.map(c => ({ type: 'file', data: c, time: new Date(c.timestamp).getTime() })),
        ...commits.map(c => ({ type: 'commit', data: c, time: new Date(c.timestamp).getTime() }))
    ].sort((a, b) => a.time - b.time);
    
    const startTime = new Date(session.startTime).getTime();
    const endTime = session.endTime ? new Date(session.endTime).getTime() : Date.now();
    const duration = endTime - startTime;
    
    // SVG dimensions
    const width = Math.max(600, allEvents.length * 50);
    const height = 200;
    const padding = { top: 40, right: 40, bottom: 50, left: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    // Generate time ticks
    const numTicks = Math.min(8, Math.floor(chartWidth / 80));
    const ticks = [];
    for (let i = 0; i <= numTicks; i++) {
        const time = startTime + (duration * i / numTicks);
        const x = padding.left + (chartWidth * i / numTicks);
        ticks.push({ x, time: new Date(time) });
    }
    
    // Generate event points
    const points = allEvents.map((event, index) => {
        const x = padding.left + ((event.time - startTime) / duration) * chartWidth;
        const y = padding.top + chartHeight / 2;
        const fileExt = event.type === 'file' ? getFileExtension(event.data.file) : '';
        const color = event.type === 'file' ? (fileTypeColors[fileExt] || fileTypeColors.default) : '';
        
        return { ...event, x, y, index, fileExt, color };
    });
    
    // Build SVG
    let svg = `
        <svg class="timeline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
            <!-- Gradient definitions -->
            <defs>
                <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style="stop-color:var(--vscode-textLink-foreground);stop-opacity:0.3" />
                    <stop offset="50%" style="stop-color:var(--vscode-textLink-foreground);stop-opacity:1" />
                    <stop offset="100%" style="stop-color:var(--vscode-textLink-foreground);stop-opacity:0.3" />
                </linearGradient>
                <filter id="glow">
                    <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
            
            <!-- Background grid lines -->
            ${ticks.map(tick => `
                <line x1="${tick.x}" y1="${padding.top}" x2="${tick.x}" y2="${height - padding.bottom}" 
                      stroke="var(--vscode-panel-border)" stroke-width="1" stroke-dasharray="4,4" opacity="0.5"/>
            `).join('')}
            
            <!-- Main timeline axis -->
            <line x1="${padding.left}" y1="${padding.top + chartHeight/2}" 
                  x2="${width - padding.right}" y2="${padding.top + chartHeight/2}" 
                  stroke="url(#lineGradient)" stroke-width="3" stroke-linecap="round"/>
            
            <!-- Time ticks and labels -->
            ${ticks.map(tick => `
                <line x1="${tick.x}" y1="${height - padding.bottom + 5}" 
                      x2="${tick.x}" y2="${height - padding.bottom + 15}" 
                      class="timeline-tick"/>
                <text x="${tick.x}" y="${height - padding.bottom + 30}" 
                      class="timeline-tick-label">${formatTimeShort(tick.time)}</text>
            `).join('')}
            
            <!-- Event points with animations -->
            ${points.map((point, i) => {
                const delay = i * 0.05;
                if (point.type === 'commit') {
                    // Diamond shape for commits
                    return `
                        <g class="timeline-point commit" 
                           data-index="${point.index}" 
                           data-type="commit"
                           onmouseenter="showTooltip(event, ${point.index}, 'commit')"
                           onmouseleave="hideTooltip()"
                           onclick="showChangeModal(${point.index}, 'commit')"
                           style="animation: popIn 0.3s ease ${delay}s both;">
                            <rect x="${point.x - 8}" y="${point.y - 8}" width="16" height="16" 
                                  transform="rotate(45 ${point.x} ${point.y})"
                                  fill="var(--vscode-terminal-ansiYellow)" 
                                  filter="url(#glow)"/>
                        </g>
                    `;
                } else {
                    // Circle for file changes
                    return `
                        <g class="timeline-point file-change" 
                           data-index="${point.index}" 
                           data-type="file"
                           onmouseenter="showTooltip(event, ${point.index}, 'file')"
                           onmouseleave="hideTooltip()"
                           onclick="showChangeModal(${point.index}, 'file')"
                           style="animation: popIn 0.3s ease ${delay}s both;">
                            <circle cx="${point.x}" cy="${point.y}" r="8" 
                                    fill="${point.color}" 
                                    filter="url(#glow)"/>
                        </g>
                    `;
                }
            }).join('')}
            
            <!-- Animation styles -->
            <style>
                @keyframes popIn {
                    from { opacity: 0; transform: scale(0); }
                    to { opacity: 1; transform: scale(1); }
                }
                .timeline-point { transform-origin: center; }
                .timeline-point:hover { filter: brightness(1.3) !important; }
            </style>
        </svg>
    `;
    
    return svg;
}

/**
 * Render the list of changes
 */
function renderChangesList(session) {
    const changes = session.changes || [];
    const commits = session.commits || [];
    
    // Combine and sort all events
    const allEvents = [
        ...changes.map((c, i) => ({ type: 'file', data: c, time: new Date(c.timestamp).getTime(), index: i })),
        ...commits.map((c, i) => ({ type: 'commit', data: c, time: new Date(c.timestamp).getTime(), index: i }))
    ].sort((a, b) => b.time - a.time); // Most recent first
    
    if (allEvents.length === 0) {
        return '<div class="empty-state"><p>No changes recorded</p></div>';
    }
    
    return allEvents.map(event => {
        if (event.type === 'commit') {
            return `
                <div class="change-item" onclick="showChangeModal(${event.index}, 'commit')">
                    <div class="change-icon commit">📝</div>
                    <div class="change-info">
                        <div class="change-name">${event.data.message}</div>
                        <div class="change-time">${event.data.hash.substring(0, 7)} • ${event.data.author} • ${formatTimeAgo(event.data.timestamp)}</div>
                    </div>
                </div>
            `;
        } else {
            const fileName = event.data.file.split('/').pop();
            const fileExt = getFileExtension(event.data.file);
            return `
                <div class="change-item" onclick="showChangeModal(${event.index}, 'file')">
                    <div class="change-icon file" style="background: ${fileTypeColors[fileExt] || fileTypeColors.default};">📄</div>
                    <div class="change-info">
                        <div class="change-name">${fileName}</div>
                        <div class="change-time">${event.data.file} • ${formatTimeAgo(event.data.timestamp)}</div>
                    </div>
                </div>
            `;
        }
    }).join('');
}

/**
 * Setup timeline interaction handlers
 */
function setupTimelineInteractions() {
    // Tooltip is handled via inline event handlers in SVG
}

/**
 * Show tooltip for timeline point
 */
function showTooltip(event, index, type) {
    let tooltip = document.getElementById('timeline-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'timeline-tooltip';
        tooltip.className = 'timeline-tooltip';
        document.body.appendChild(tooltip);
    }
    
    let content = '';
    if (type === 'commit') {
        const commit = currentSession.commits[index];
        content = `
            <div class="tooltip-title">${commit.message}</div>
            <div class="tooltip-time">${formatTimeAgo(commit.timestamp)}</div>
            <span class="tooltip-type commit">Commit</span>
        `;
    } else {
        const change = currentSession.changes[index];
        const fileName = change.file.split('/').pop();
        content = `
            <div class="tooltip-title">${fileName}</div>
            <div class="tooltip-time">${formatTimeAgo(change.timestamp)}</div>
            <span class="tooltip-type file">File Save</span>
        `;
    }
    
    tooltip.innerHTML = content;
    tooltip.style.left = `${event.pageX + 10}px`;
    tooltip.style.top = `${event.pageY + 10}px`;
    tooltip.classList.add('visible');
}

/**
 * Hide tooltip
 */
function hideTooltip() {
    const tooltip = document.getElementById('timeline-tooltip');
    if (tooltip) {
        tooltip.classList.remove('visible');
    }
}

/**
 * Show modal with change details
 */
function showChangeModal(index, type) {
    let modalOverlay = document.getElementById('modal-overlay');
    if (!modalOverlay) {
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'modal-overlay';
        modalOverlay.className = 'modal-overlay';
        modalOverlay.onclick = (e) => {
            if (e.target === modalOverlay) closeModal();
        };
        document.body.appendChild(modalOverlay);
    }
    
    let content = '';
    
    if (type === 'commit') {
        const commit = currentSession.commits[index];
        content = `
            <div class="modal">
                <div class="modal-header">
                    <div class="modal-title">📝 Commit Details</div>
                    <button class="modal-close" onclick="closeModal()">✕</button>
                </div>
                <div class="modal-body">
                    <div class="modal-meta">
                        <div class="modal-meta-item">
                            <div class="modal-meta-label">Hash</div>
                            <div class="modal-meta-value">${commit.hash.substring(0, 12)}...</div>
                        </div>
                        <div class="modal-meta-item">
                            <div class="modal-meta-label">Author</div>
                            <div class="modal-meta-value">${commit.author}</div>
                        </div>
                        <div class="modal-meta-item">
                            <div class="modal-meta-label">Time</div>
                            <div class="modal-meta-value">${new Date(commit.timestamp).toLocaleString()}</div>
                        </div>
                        <div class="modal-meta-item">
                            <div class="modal-meta-label">Message</div>
                            <div class="modal-meta-value">${commit.message}</div>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn btn-primary" onclick="viewCommitInEditor('${commit.hash}')">
                            View in Editor
                        </button>
                    </div>
                </div>
            </div>
        `;
    } else {
        const change = currentSession.changes[index];
        const fileName = change.file.split('/').pop();
        const fileExt = getFileExtension(change.file);
        const contentPreview = change.content ? 
            (change.content.length > 2000 ? change.content.substring(0, 2000) + '\n... (truncated)' : change.content) 
            : 'No content available';
        
        content = `
            <div class="modal">
                <div class="modal-header">
                    <div class="modal-title">📄 ${fileName}</div>
                    <button class="modal-close" onclick="closeModal()">✕</button>
                </div>
                <div class="modal-body">
                    <div class="modal-meta">
                        <div class="modal-meta-item">
                            <div class="modal-meta-label">File Path</div>
                            <div class="modal-meta-value">${change.file}</div>
                        </div>
                        <div class="modal-meta-item">
                            <div class="modal-meta-label">Saved At</div>
                            <div class="modal-meta-value">${new Date(change.timestamp).toLocaleString()}</div>
                        </div>
                        <div class="modal-meta-item">
                            <div class="modal-meta-label">File Type</div>
                            <div class="modal-meta-value">${fileExt.toUpperCase() || 'Unknown'}</div>
                        </div>
                        <div class="modal-meta-item">
                            <div class="modal-meta-label">Content Size</div>
                            <div class="modal-meta-value">${formatBytes(change.content?.length || 0)}</div>
                        </div>
                    </div>
                    <div class="file-content-preview">
                        <div class="file-content-header">
                            <span class="file-content-title">Content Snapshot</span>
                        </div>
                        <div class="file-content-body">
                            <pre>${escapeHtml(contentPreview)}</pre>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn btn-primary" onclick="openFileInEditor('${change.file}', ${index})">
                            Open File
                        </button>
                        <button class="btn btn-secondary" onclick="copyContent(${index})">
                            Copy Content
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    modalOverlay.innerHTML = content;
    setTimeout(() => modalOverlay.classList.add('visible'), 10);
}

/**
 * Close modal
 */
function closeModal() {
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('visible');
    }
}

/**
 * Open file in editor
 */
function openFileInEditor(filePath, index) {
    vscode.postMessage({ 
        command: 'openFile', 
        filePath: filePath,
        changeIndex: index 
    });
    closeModal();
}

/**
 * View commit in editor
 */
function viewCommitInEditor(hash) {
    vscode.postMessage({ 
        command: 'viewCommit', 
        hash: hash 
    });
    closeModal();
}

/**
 * Copy file content to clipboard
 */
function copyContent(index) {
    const change = currentSession.changes[index];
    if (change && change.content) {
        navigator.clipboard.writeText(change.content).then(() => {
            vscode.postMessage({ command: 'showMessage', message: 'Content copied to clipboard!' });
        });
    }
}

/**
 * Go back to session list
 */
function backToList() {
    currentView = 'list';
    currentSession = null;
    document.getElementById('list-view').style.display = 'block';
    document.getElementById('detail-view').classList.remove('visible');
}

/**
 * Refresh sessions
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

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatDate(date) {
    return date.toLocaleDateString(undefined, { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}

function formatTime(date) {
    return date.toLocaleTimeString(undefined, { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

function formatTimeShort(date) {
    return date.toLocaleTimeString(undefined, { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
    });
}

function formatTimeAgo(timestamp) {
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    const diff = now - time;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

function calculateDuration(startTime, endTime) {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    return Math.round((end - start) / 60000);
}

function getFileExtension(filePath) {
    const match = filePath.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : '';
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
