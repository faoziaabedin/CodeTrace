/**
 * SessionTimelinePanel
 * 
 * Manages the webview panel for displaying session timeline.
 * Handles message passing between extension and webview.
 * 
 * VS Code Webview API:
 * - WebviewPanel: A panel that contains a webview
 * - webview.html: Set the HTML content of the webview
 * - webview.postMessage(): Send messages to the webview
 * - webview.onDidReceiveMessage: Handle messages from the webview
 */

import * as vscode from 'vscode';
import * as path from 'path';

// Interface for session data
interface SessionData {
    sessionId: string;
    startTime: string;
    endTime?: string;
    repository?: string;
    changes: Array<{
        file: string;
        timestamp: string;
        content: string;
    }>;
    commits: Array<{
        hash: string;
        message: string;
        author: string;
        timestamp: string;
    }>;
    stats?: {
        filesChanged: number;
        commitsCount: number;
        duration: string;
    };
}

export class SessionTimelinePanel {
    // Track the current panel instance (singleton pattern)
    public static currentPanel: SessionTimelinePanel | undefined;

    // Identifier for the webview panel type
    public static readonly viewType = 'codetraceTimeline';

    // The actual webview panel
    private readonly _panel: vscode.WebviewPanel;
    
    // Extension URI for loading local resources
    private readonly _extensionUri: vscode.Uri;
    
    // Disposables for cleanup
    private _disposables: vscode.Disposable[] = [];

    // Cache of loaded sessions
    private _sessionsCache: SessionData[] = [];

    /**
     * Creates or shows the session timeline panel.
     */
    public static createOrShow(extensionUri: vscode.Uri): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (SessionTimelinePanel.currentPanel) {
            SessionTimelinePanel.currentPanel._panel.reveal(column);
            return;
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            SessionTimelinePanel.viewType,
            'CodeTrace Sessions',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'src', 'webview'),
                    vscode.Uri.joinPath(extensionUri, 'out', 'webview')
                ],
                retainContextWhenHidden: true
            }
        );

        SessionTimelinePanel.currentPanel = new SessionTimelinePanel(panel, extensionUri);
    }

    /**
     * Revive the panel if VS Code restarts
     */
    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
        SessionTimelinePanel.currentPanel = new SessionTimelinePanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's HTML content
        this._update();

        // Handle panel disposal
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                await this._handleMessage(message);
            },
            null,
            this._disposables
        );

        // Update content when panel becomes visible
        this._panel.onDidChangeViewState(
            () => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Handle messages received from the webview
     */
    private async _handleMessage(message: { 
        command: string; 
        sessionId?: string;
        filePath?: string;
        changeIndex?: number;
        hash?: string;
        message?: string;
    }): Promise<void> {
        switch (message.command) {
            case 'refresh':
                // Load and send sessions to webview
                const sessions = await this._loadSessions();
                this._sessionsCache = sessions;
                this._panel.webview.postMessage({
                    command: 'loadSessions',
                    sessions: sessions
                });
                break;

            case 'loadSession':
                // Send detailed session data
                if (message.sessionId) {
                    const session = this._sessionsCache.find(s => s.sessionId === message.sessionId);
                    if (session) {
                        this._panel.webview.postMessage({
                            command: 'sessionLoaded',
                            session: session
                        });
                    }
                }
                break;

            case 'generateSummary':
                // Execute the generate summary command
                // This will open the command palette experience
                await vscode.commands.executeCommand('codetrace.generateSummary');
                // After summary is generated, refresh the sessions
                setTimeout(async () => {
                    const updatedSessions = await this._loadSessions();
                    this._sessionsCache = updatedSessions;
                    this._panel.webview.postMessage({
                        command: 'loadSessions',
                        sessions: updatedSessions
                    });
                }, 1000);
                break;

            case 'openFile':
                // Open a file in the editor
                if (message.filePath) {
                    await this._openFile(message.filePath, message.changeIndex);
                }
                break;

            case 'viewCommit':
                // Show commit in source control
                if (message.hash) {
                    await this._viewCommit(message.hash);
                }
                break;

            case 'viewDetails':
                // Show session details in quick pick
                if (message.sessionId) {
                    await this._showSessionDetails(message.sessionId);
                }
                break;

            case 'showMessage':
                // Show info message
                if (message.message) {
                    vscode.window.showInformationMessage(message.message);
                }
                break;
        }
    }

    /**
     * Open a file in the editor
     * @param filePath - Path to the file relative to workspace
     * @param _changeIndex - Index of the change (reserved for future diff view)
     */
    private async _openFile(filePath: string, _changeIndex?: number): Promise<void> {
        const workspaceRoot = this._getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        try {
            const fullPath = vscode.Uri.joinPath(workspaceRoot, filePath);
            const document = await vscode.workspace.openTextDocument(fullPath);
            await vscode.window.showTextDocument(document);
            
            vscode.window.showInformationMessage(`Opened: ${filePath}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
        }
    }

    /**
     * View commit details (could integrate with git extension)
     */
    private async _viewCommit(hash: string): Promise<void> {
        // Try to execute git show command or open source control
        try {
            // Show the commit hash - in future could integrate with Git extension
            vscode.window.showInformationMessage(`Commit: ${hash.substring(0, 7)}`);
            
            // Try to copy to clipboard
            await vscode.env.clipboard.writeText(hash);
            vscode.window.showInformationMessage(`Commit hash copied to clipboard: ${hash.substring(0, 7)}`);
        } catch (error) {
            console.error('Error viewing commit:', error);
        }
    }

    /**
     * Load all sessions from the .codetrace folder
     */
    private async _loadSessions(): Promise<SessionData[]> {
        const workspaceRoot = this._getWorkspaceRoot();
        if (!workspaceRoot) {
            return [];
        }

        try {
            const codetraceDir = vscode.Uri.joinPath(workspaceRoot, '.codetrace');
            
            let files: [string, vscode.FileType][];
            try {
                files = await vscode.workspace.fs.readDirectory(codetraceDir);
            } catch {
                return [];
            }

            const sessionFiles = files
                .filter(([name, type]) => 
                    type === vscode.FileType.File && 
                    name.startsWith('session-') && 
                    name.endsWith('.json')
                )
                .map(([name]) => name)
                .sort()
                .reverse();

            const sessions: SessionData[] = [];
            const decoder = new TextDecoder();

            for (const filename of sessionFiles) {
                try {
                    const filePath = vscode.Uri.joinPath(codetraceDir, filename);
                    const data = await vscode.workspace.fs.readFile(filePath);
                    const session: SessionData = JSON.parse(decoder.decode(data));
                    sessions.push(session);
                } catch (error) {
                    console.error(`CodeTrace: Error loading session ${filename}`, error);
                }
            }

            return sessions;

        } catch (error) {
            console.error('CodeTrace: Error loading sessions', error);
            return [];
        }
    }

    /**
     * Show detailed session info in a quick pick
     */
    private async _showSessionDetails(sessionId: string): Promise<void> {
        const session = this._sessionsCache.find(s => s.sessionId === sessionId);

        if (!session) {
            vscode.window.showErrorMessage('Session not found');
            return;
        }

        const items: vscode.QuickPickItem[] = [
            {
                label: '$(info) Session ID',
                description: session.sessionId,
                detail: ''
            },
            {
                label: '$(calendar) Started',
                description: new Date(session.startTime).toLocaleString(),
                detail: ''
            }
        ];

        if (session.endTime) {
            items.push({
                label: '$(calendar) Ended',
                description: new Date(session.endTime).toLocaleString(),
                detail: ''
            });
        }

        if (session.repository) {
            items.push({
                label: '$(repo) Repository',
                description: session.repository,
                detail: ''
            });
        }

        items.push({
            label: 'Files Changed',
            kind: vscode.QuickPickItemKind.Separator
        } as vscode.QuickPickItem);

        const uniqueFiles = [...new Set(session.changes.map(c => c.file))];
        for (const file of uniqueFiles.slice(0, 10)) {
            const saveCount = session.changes.filter(c => c.file === file).length;
            items.push({
                label: `$(file-code) ${path.basename(file)}`,
                description: path.dirname(file),
                detail: `${saveCount} save${saveCount > 1 ? 's' : ''}`
            });
        }

        if (uniqueFiles.length > 10) {
            items.push({
                label: `... and ${uniqueFiles.length - 10} more files`,
                description: '',
                detail: ''
            });
        }

        if (session.commits.length > 0) {
            items.push({
                label: 'Commits',
                kind: vscode.QuickPickItemKind.Separator
            } as vscode.QuickPickItem);

            for (const commit of session.commits.slice(0, 5)) {
                items.push({
                    label: `$(git-commit) ${commit.hash.substring(0, 7)}`,
                    description: commit.message.substring(0, 50),
                    detail: `by ${commit.author} at ${new Date(commit.timestamp).toLocaleString()}`
                });
            }
        }

        await vscode.window.showQuickPick(items, {
            title: `Session Details - ${sessionId.substring(0, 8)}...`,
            placeHolder: 'Session information'
        });
    }

    /**
     * Get workspace root URI
     */
    private _getWorkspaceRoot(): vscode.Uri | undefined {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return folders[0].uri;
        }
        return undefined;
    }

    /**
     * Update the webview content
     */
    private _update(): void {
        this._panel.title = 'CodeTrace Sessions';
        this._panel.webview.html = this._getHtmlForWebview();
    }

    /**
     * Generate the HTML content for the webview
     */
    private _getHtmlForWebview(): string {
        const webview = this._panel.webview;

        // Get URIs for local resources
        const stylesUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'styles.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'script.js')
        );

        const cspSource = webview.cspSource;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
    <title>CodeTrace - Session Timeline</title>
    <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
    <div class="header">
        <h1>
            <span class="icon">⏱️</span>
            CodeTrace Sessions
        </h1>
        <div class="header-actions">
            <button class="btn btn-secondary" onclick="refresh()">
                🔄 Refresh
            </button>
        </div>
    </div>
    
    <!-- List View -->
    <div id="list-view">
        <div id="stats-summary" class="stats-summary">
            <!-- Summary stats rendered by JS -->
        </div>
        
        <div id="session-list" class="session-list">
            <div class="loading">
                <div class="spinner"></div>
                <p>Loading sessions...</p>
            </div>
        </div>
    </div>
    
    <!-- Detail View (hidden initially) -->
    <div id="detail-view" class="timeline-detail-view">
        <!-- Populated by JS when session is selected -->
    </div>
    
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Clean up resources when panel is closed
     */
    public dispose(): void {
        SessionTimelinePanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
