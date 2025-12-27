/**
 * SessionTimelinePanel
 * 
 * Manages the webview panel for displaying session timeline.
 * Uses VS Code's Webview API to create an interactive panel.
 * 
 * VS Code Webview API:
 * - WebviewPanel: A panel that contains a webview
 * - webview.html: Set the HTML content of the webview
 * - webview.postMessage(): Send messages to the webview
 * - webview.onDidReceiveMessage: Handle messages from the webview
 */

import * as vscode from 'vscode';
import * as path from 'path';

// Interface for session data (matches the main extension)
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

    /**
     * Creates or shows the session timeline panel.
     * Uses singleton pattern - only one panel can exist at a time.
     * 
     * @param extensionUri - The URI of the extension directory
     */
    public static createOrShow(extensionUri: vscode.Uri): void {
        // Determine which column to show the panel in
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (SessionTimelinePanel.currentPanel) {
            SessionTimelinePanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            SessionTimelinePanel.viewType,
            'CodeTrace Sessions',
            column || vscode.ViewColumn.One,
            {
                // Enable JavaScript in the webview
                enableScripts: true,
                // Restrict the webview to only load resources from specific directories
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'src', 'webview'),
                    vscode.Uri.joinPath(extensionUri, 'out', 'webview')
                ],
                // Retain state when panel is hidden
                retainContextWhenHidden: true
            }
        );

        SessionTimelinePanel.currentPanel = new SessionTimelinePanel(panel, extensionUri);
    }

    /**
     * Private constructor - use createOrShow() instead
     */
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
    private async _handleMessage(message: { command: string; sessionId?: string }): Promise<void> {
        switch (message.command) {
            case 'refresh':
                // Load and send sessions to webview
                const sessions = await this._loadSessions();
                this._panel.webview.postMessage({
                    command: 'loadSessions',
                    sessions: sessions
                });
                break;

            case 'loadSession':
                // Handle load session request
                if (message.sessionId) {
                    vscode.window.showInformationMessage(
                        `Loading session: ${message.sessionId.substring(0, 8)}...`
                    );
                    // Future: Could implement session replay here
                }
                break;

            case 'viewDetails':
                // Show session details in a quick pick or new panel
                if (message.sessionId) {
                    await this._showSessionDetails(message.sessionId);
                }
                break;
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
            
            // List files in .codetrace directory
            let files: [string, vscode.FileType][];
            try {
                files = await vscode.workspace.fs.readDirectory(codetraceDir);
            } catch {
                // Directory doesn't exist
                return [];
            }

            // Filter for session JSON files
            const sessionFiles = files
                .filter(([name, type]) => 
                    type === vscode.FileType.File && 
                    name.startsWith('session-') && 
                    name.endsWith('.json')
                )
                .map(([name]) => name)
                .sort()
                .reverse(); // Most recent first

            // Load each session file
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
        const sessions = await this._loadSessions();
        const session = sessions.find(s => s.sessionId === sessionId);

        if (!session) {
            vscode.window.showErrorMessage('Session not found');
            return;
        }

        // Build quick pick items with session details
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

        // Add separator and file list
        items.push({
            label: 'Files Changed',
            kind: vscode.QuickPickItemKind.Separator
        } as vscode.QuickPickItem);

        // Get unique files
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

        // Add commits section
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
     * Generate the HTML content for the webview.
     * Loads the HTML template and replaces placeholders with actual URIs.
     */
    private _getHtmlForWebview(): string {
        const webview = this._panel.webview;

        // Get URIs for local resources
        // webview.asWebviewUri() converts a local URI to one that can be used in the webview
        const stylesUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'styles.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'script.js')
        );

        // Content Security Policy
        // This restricts what content can be loaded in the webview for security
        const cspSource = webview.cspSource;

        // Return the HTML with placeholders replaced
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
        <button class="refresh-btn" onclick="refresh()">
            <span>🔄</span>
            Refresh
        </button>
    </div>
    
    <div id="stats-summary" class="stats-summary">
        <!-- Summary stats will be rendered here -->
    </div>
    
    <div id="session-list" class="session-list">
        <div class="loading">
            <div class="spinner"></div>
            <p>Loading sessions...</p>
        </div>
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

        // Clean up resources
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

