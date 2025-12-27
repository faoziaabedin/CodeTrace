/**
 * SessionTimelinePanel - Webview UI for CodeTrace
 * 
 * This manages the webview panel that displays the session timeline.
 * I chose to use VS Code's webview API because it allows for rich,
 * interactive UI while still being sandboxed for security.
 * 
 * The architecture is:
 * - Extension side (this file): Manages panel lifecycle, loads data
 * - Webview side (webview/*.js): Handles UI rendering and interactions
 * - Communication: postMessage API for sending data back and forth
 * 
 * @author Faozia Abedin
 */

import * as vscode from 'vscode';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Session data structure - same as in extension.ts
 * Would be nice to share these types, but keeping it simple for now
 */
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
    summary?: {
        whatWasBuilt: string;
        keyFilesModified: string[];
        apparentGoal: string;
        suggestedTitle: string;
        generatedAt: string;
        model: string;
    };
}

// ============================================================================
// PANEL CLASS
// ============================================================================

export class SessionTimelinePanel {
    // Singleton pattern - only one panel at a time
    // This prevents opening multiple instances of the same view
    public static currentPanel: SessionTimelinePanel | undefined;

    // Used by VS Code to identify the webview type
    public static readonly viewType = 'codetraceTimeline';

    // The actual webview panel instance
    private readonly _panel: vscode.WebviewPanel;
    
    // Path to extension - needed to load local resources
    private readonly _extensionUri: vscode.Uri;
    
    // Cleanup handlers - important for preventing memory leaks
    private _disposables: vscode.Disposable[] = [];

    // Cache loaded sessions to avoid re-reading files
    private _sessionsCache: SessionData[] = [];

    /**
     * Creates or reveals the timeline panel
     * Uses singleton pattern - calling this multiple times just reveals the existing panel
     */
    public static createOrShow(extensionUri: vscode.Uri): void {
        // Figure out which column to show the panel in
        // Default to the current editor column, or column 1 if no editor is open
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, just reveal it
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
                // Enable JavaScript - needed for our interactive UI
                enableScripts: true,
                
                // Only allow the webview to load resources from specific folders
                // This is a security feature to prevent loading arbitrary files
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'src', 'webview'),
                    vscode.Uri.joinPath(extensionUri, 'out', 'webview')
                ],
                
                // Keep the webview content even when hidden
                // This means we don't lose state when switching tabs
                retainContextWhenHidden: true
            }
        );

        SessionTimelinePanel.currentPanel = new SessionTimelinePanel(panel, extensionUri);
    }

    /**
     * Private constructor - use createOrShow() instead
     * This is part of the singleton pattern
     */
    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set up the initial HTML content
        this._update();

        // Handle panel being closed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Listen for messages from the webview
        // This is how the UI communicates back to the extension
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                await this._handleMessage(message);
            },
            null,
            this._disposables
        );

        // Refresh content when panel becomes visible again
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
     * Handles messages from the webview
     * This is the main communication channel for UI interactions
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
            // Webview is asking for fresh data
            case 'refresh':
                const sessions = await this._loadSessions();
                this._sessionsCache = sessions;
                this._panel.webview.postMessage({
                    command: 'loadSessions',
                    sessions: sessions
                });
                break;

            // User selected a session to view
            case 'loadSession':
                if (message.sessionId) {
                    const session = this._sessionsCache.find(
                        s => s.sessionId === message.sessionId
                    );
                    if (session) {
                        this._panel.webview.postMessage({
                            command: 'sessionLoaded',
                            session: session
                        });
                    }
                }
                break;

            // User wants to generate AI summary from the webview
            case 'generateSummary':
                await vscode.commands.executeCommand('codetrace.generateSummary');
                // Give it a second then refresh
                setTimeout(async () => {
                    const updatedSessions = await this._loadSessions();
                    this._sessionsCache = updatedSessions;
                    this._panel.webview.postMessage({
                        command: 'loadSessions',
                        sessions: updatedSessions
                    });
                }, 1000);
                break;

            // User wants to open a file
            case 'openFile':
                if (message.filePath) {
                    await this._openFile(message.filePath);
                }
                break;

            // User clicked on a commit
            case 'viewCommit':
                if (message.hash) {
                    await this._viewCommit(message.hash);
                }
                break;

            // Show a notification (from webview)
            case 'showMessage':
                if (message.message) {
                    vscode.window.showInformationMessage(message.message);
                }
                break;
        }
    }

    /**
     * Opens a file in the editor
     */
    private async _openFile(filePath: string): Promise<void> {
        const workspaceRoot = this._getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        try {
            const fullPath = vscode.Uri.joinPath(workspaceRoot, filePath);
            const document = await vscode.workspace.openTextDocument(fullPath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
        }
    }

    /**
     * Shows commit info and copies hash to clipboard
     * In the future, could integrate with Git extension
     */
    private async _viewCommit(hash: string): Promise<void> {
        try {
            await vscode.env.clipboard.writeText(hash);
            vscode.window.showInformationMessage(
                `Commit hash copied: ${hash.substring(0, 7)}`
            );
        } catch (error) {
            console.error('Error viewing commit:', error);
        }
    }

    /**
     * Loads all sessions from the .codetrace folder
     * Sessions are stored as individual JSON files
     */
    private async _loadSessions(): Promise<SessionData[]> {
        const workspaceRoot = this._getWorkspaceRoot();
        if (!workspaceRoot) return [];

        try {
            const codetraceDir = vscode.Uri.joinPath(workspaceRoot, '.codetrace');
            
            // Try to read the directory
            let files: [string, vscode.FileType][];
            try {
                files = await vscode.workspace.fs.readDirectory(codetraceDir);
            } catch {
                // Directory doesn't exist yet - that's fine
                return [];
            }

            // Filter for session JSON files and sort newest first
            const sessionFiles = files
                .filter(([name, type]) => 
                    type === vscode.FileType.File && 
                    name.startsWith('session-') && 
                    name.endsWith('.json')
                )
                .map(([name]) => name)
                .sort()
                .reverse();

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
                    // Skip corrupted files but log the error
                    console.error(`CodeTrace: Error loading ${filename}:`, error);
                }
            }

            return sessions;

        } catch (error) {
            console.error('CodeTrace: Error loading sessions:', error);
            return [];
        }
    }

    /**
     * Gets the workspace root folder
     */
    private _getWorkspaceRoot(): vscode.Uri | undefined {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri : undefined;
    }

    /**
     * Updates the webview HTML content
     */
    private _update(): void {
        this._panel.title = 'CodeTrace Sessions';
        this._panel.webview.html = this._getHtmlForWebview();
    }

    /**
     * Generates the HTML for the webview
     * This loads our CSS and JS files with proper URIs
     */
    private _getHtmlForWebview(): string {
        const webview = this._panel.webview;

        // Convert local file paths to webview URIs
        // This is required for security - webviews can't load arbitrary files
        const stylesUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'styles.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'script.js')
        );

        // Content Security Policy - important for security
        // This restricts what the webview can load and execute
        const cspSource = webview.cspSource;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
    <title>CodeTrace Sessions</title>
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
    
    <!-- List View - shows all sessions -->
    <div id="list-view">
        <div id="stats-summary" class="stats-summary"></div>
        <div id="session-list" class="session-list">
            <div class="loading">
                <div class="spinner"></div>
                <p>Loading sessions...</p>
            </div>
        </div>
    </div>
    
    <!-- Detail View - shows single session timeline -->
    <div id="detail-view" class="timeline-detail-view"></div>
    
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Cleanup when panel is closed
     */
    public dispose(): void {
        SessionTimelinePanel.currentPanel = undefined;

        // Dispose of the panel
        this._panel.dispose();

        // Dispose of all subscriptions
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
