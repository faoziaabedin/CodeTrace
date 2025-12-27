/**
 * CodeTrace Extension
 * 
 * This is the main entry point for the CodeTrace VS Code extension.
 * It handles recording coding sessions by tracking file saves and git commits.
 * 
 * Key Components:
 * - activate(): Called when the extension is first activated
 * - deactivate(): Called when the extension is deactivated
 * - RecordingManager: Class that manages the recording state, file tracking, and storage
 * - GitTracker: Class that handles git repository detection and commit tracking
 * 
 * VS Code Workspace API Used:
 * - workspace.onDidSaveTextDocument: Fires when a text document is saved
 * - workspace.workspaceFolders: Gets the workspace folder paths
 * - workspace.fs: File system API for reading/writing files
 * 
 * Git Tracking:
 * - Uses simple-git npm package for git operations
 * - Detects if workspace is a git repository
 * - Polls for new commits during recording session
 */

import * as vscode from 'vscode';
import * as path from 'path';
import simpleGit, { SimpleGit, LogResult } from 'simple-git';
import { SessionTimelinePanel } from './SessionTimelinePanel';
import { AIService, SessionSummary } from './AIService';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Represents a single file change event during a recording session.
 */
interface FileChange {
    /** Relative path to the file from workspace root */
    file: string;
    /** ISO timestamp when the file was saved */
    timestamp: string;
    /** Complete file content at the time of save */
    content: string;
}

/**
 * Represents a git commit tracked during the session.
 */
interface CommitInfo {
    /** The commit hash (full SHA) */
    hash: string;
    /** The commit message */
    message: string;
    /** The author's name */
    author: string;
    /** ISO timestamp of the commit */
    timestamp: string;
}

/**
 * Session statistics calculated at the end of recording.
 */
interface SessionStats {
    /** Number of unique files that were changed */
    filesChanged: number;
    /** Number of commits made during the session */
    commitsCount: number;
    /** Duration of the session in minutes */
    duration: string;
}

/**
 * Represents a complete recording session with all tracked data.
 */
interface SessionData {
    /** Unique identifier for the session (UUID format) */
    sessionId: string;
    /** When the recording started (ISO timestamp) */
    startTime: string;
    /** When the recording ended (ISO timestamp) */
    endTime?: string;
    /** Name of the git repository (if available) */
    repository?: string;
    /** Array of all file changes recorded during this session */
    changes: FileChange[];
    /** Array of all commits made during this session */
    commits: CommitInfo[];
    /** Statistics about the session */
    stats?: SessionStats;
    /** AI-generated summary of the session */
    summary?: SessionSummary;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generates a UUID v4 for session identification.
 */
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Gets the workspace root folder URI.
 */
function getWorkspaceRoot(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return folders[0].uri;
    }
    return undefined;
}

/**
 * Converts an absolute file path to a path relative to the workspace root.
 */
function getRelativePath(absolutePath: string): string {
    const workspaceRoot = getWorkspaceRoot();
    if (workspaceRoot) {
        const relativePath = path.relative(workspaceRoot.fsPath, absolutePath);
        return relativePath.replace(/\\/g, '/');
    }
    return absolutePath;
}

/**
 * Calculates duration between two ISO timestamps in minutes.
 */
function calculateDuration(startTime: string, endTime: string): string {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const durationMs = end - start;
    const minutes = Math.round(durationMs / 60000);
    return `${minutes}`;
}

// ============================================================================
// GIT TRACKER CLASS
// ============================================================================

/**
 * GitTracker handles all git-related operations:
 * - Detecting if workspace is a git repository
 * - Getting repository name
 * - Tracking commits made during recording
 * 
 * Uses simple-git package for git operations.
 * simple-git is a lightweight wrapper around git CLI commands.
 */
class GitTracker {
    // SimpleGit instance for executing git commands
    private git: SimpleGit | null = null;
    
    // Whether the workspace is a valid git repository
    private isGitRepo: boolean = false;
    
    // The repository name (extracted from remote URL or folder name)
    private repoName: string = '';
    
    // Hash of the last commit seen (to detect new commits)
    private lastSeenCommitHash: string = '';
    
    // Timer for polling new commits
    private pollInterval: NodeJS.Timeout | null = null;
    
    // Callback to invoke when new commits are detected
    private onCommitCallback: ((commit: CommitInfo) => void) | null = null;

    /**
     * Initializes the git tracker for a workspace.
     * Checks if git is available and if the workspace is a repository.
     * 
     * @param workspacePath - Path to the workspace folder
     * @returns true if git is available and workspace is a git repo
     */
    async initialize(workspacePath: string): Promise<boolean> {
        try {
            // Create a simple-git instance for the workspace
            // baseDir: The directory to run git commands in
            // binary: 'git' - use system git installation
            // maxConcurrentProcesses: 1 - avoid race conditions
            this.git = simpleGit({
                baseDir: workspacePath,
                binary: 'git',
                maxConcurrentProcesses: 1,
                // Trim whitespace from command output
                trimmed: true
            });

            // Check if this is a git repository by running 'git rev-parse'
            // This command fails in non-git directories
            const isRepo = await this.git.checkIsRepo();
            
            if (!isRepo) {
                console.log('CodeTrace: Workspace is not a git repository');
                this.isGitRepo = false;
                return false;
            }

            this.isGitRepo = true;

            // Get the repository name from remote URL or folder name
            await this.fetchRepoName(workspacePath);

            // Get the most recent commit hash as our starting point
            await this.fetchLastCommitHash();

            console.log('CodeTrace: Git tracking initialized', {
                repository: this.repoName,
                lastCommit: this.lastSeenCommitHash.substring(0, 7)
            });

            return true;

        } catch (error) {
            // Git might not be installed or accessible
            console.log('CodeTrace: Git not available or error initializing', error);
            this.isGitRepo = false;
            return false;
        }
    }

    /**
     * Fetches the repository name from the remote URL or uses folder name.
     */
    private async fetchRepoName(workspacePath: string): Promise<void> {
        if (!this.git) return;

        try {
            // Try to get the remote URL (usually 'origin')
            const remotes = await this.git.getRemotes(true);
            const origin = remotes.find(r => r.name === 'origin');
            
            if (origin && origin.refs.fetch) {
                // Extract repo name from URL
                // Examples:
                // - https://github.com/user/repo.git -> repo
                // - git@github.com:user/repo.git -> repo
                const url = origin.refs.fetch;
                const match = url.match(/\/([^/]+?)(\.git)?$/);
                if (match) {
                    this.repoName = match[1];
                    return;
                }
            }
        } catch (error) {
            console.log('CodeTrace: Could not get remote URL', error);
        }

        // Fallback: use folder name
        this.repoName = path.basename(workspacePath);
    }

    /**
     * Fetches the hash of the most recent commit.
     */
    private async fetchLastCommitHash(): Promise<void> {
        if (!this.git) return;

        try {
            // Get the latest commit log (just 1 entry)
            const log = await this.git.log({ maxCount: 1 });
            if (log.latest) {
                this.lastSeenCommitHash = log.latest.hash;
            }
        } catch (error) {
            // No commits yet in the repository
            console.log('CodeTrace: No commits found in repository');
            this.lastSeenCommitHash = '';
        }
    }

    /**
     * Starts polling for new commits.
     * Checks every 5 seconds for commits newer than the last seen.
     * 
     * @param onCommit - Callback function invoked when a new commit is detected
     */
    startTracking(onCommit: (commit: CommitInfo) => void): void {
        if (!this.isGitRepo || !this.git) {
            return;
        }

        this.onCommitCallback = onCommit;

        // Poll for new commits every 5 seconds
        // This is a simple approach; alternatives include:
        // - File system watcher on .git/refs/heads
        // - Git hooks (requires setup in the repo)
        this.pollInterval = setInterval(async () => {
            await this.checkForNewCommits();
        }, 5000);

        console.log('CodeTrace: Started git commit tracking');
    }

    /**
     * Checks for commits made since the last seen commit.
     */
    private async checkForNewCommits(): Promise<void> {
        if (!this.git || !this.onCommitCallback) return;

        try {
            // Get recent commits (last 10 to catch any we might have missed)
            const log: LogResult = await this.git.log({ maxCount: 10 });

            // Find any commits newer than our last seen
            const newCommits: CommitInfo[] = [];
            
            for (const commit of log.all) {
                // Stop when we reach the last commit we've seen
                if (commit.hash === this.lastSeenCommitHash) {
                    break;
                }

                // This is a new commit
                newCommits.push({
                    hash: commit.hash,
                    message: commit.message,
                    author: commit.author_name,
                    // Convert git date to ISO format
                    timestamp: new Date(commit.date).toISOString()
                });
            }

            // Process new commits (oldest first)
            newCommits.reverse();
            for (const commit of newCommits) {
                console.log('CodeTrace: New commit detected', {
                    hash: commit.hash.substring(0, 7),
                    message: commit.message.substring(0, 50)
                });
                this.onCommitCallback(commit);
            }

            // Update last seen hash
            if (log.latest) {
                this.lastSeenCommitHash = log.latest.hash;
            }

        } catch (error) {
            console.error('CodeTrace: Error checking for new commits', error);
        }
    }

    /**
     * Stops tracking commits.
     */
    stopTracking(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.onCommitCallback = null;
        console.log('CodeTrace: Stopped git commit tracking');
    }

    /**
     * Returns whether git tracking is available.
     */
    isAvailable(): boolean {
        return this.isGitRepo;
    }

    /**
     * Returns the repository name.
     */
    getRepoName(): string {
        return this.repoName;
    }

    /**
     * Cleans up resources.
     */
    dispose(): void {
        this.stopTracking();
        this.git = null;
    }
}

// ============================================================================
// RECORDING MANAGER CLASS
// ============================================================================

/**
 * RecordingManager handles all recording-related functionality:
 * - Starting and stopping recording sessions
 * - Managing the status bar indicator
 * - Listening to file save events
 * - Coordinating with GitTracker for commit tracking
 * - Saving session data to JSON files
 */
class RecordingManager {
    // Status bar item showing recording state and file count
    private statusBarItem: vscode.StatusBarItem;
    
    // Current recording state
    private isRecording: boolean = false;
    
    // The current active session data
    private currentSession: SessionData | null = null;
    
    // Disposable for the document save listener
    private saveListener: vscode.Disposable | null = null;
    
    // Git tracker for commit monitoring
    private gitTracker: GitTracker;
    
    // Count of unique files changed
    private filesChangedCount: number = 0;
    
    // Set to track unique file paths
    private uniqueFilesChanged: Set<string> = new Set();

    constructor() {
        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        
        // Create git tracker instance
        this.gitTracker = new GitTracker();
        
        // Set initial state
        this.updateStatusBar();
        this.statusBarItem.show();
    }

    /**
     * Updates the status bar text and appearance based on recording state.
     */
    private updateStatusBar(): void {
        if (this.isRecording) {
            const commitCount = this.currentSession?.commits.length || 0;
            // Show files and commits count
            this.statusBarItem.text = `$(record) CodeTrace: Recording (${this.filesChangedCount} files, ${commitCount} commits)`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
            this.statusBarItem.tooltip = `Recording session\n${this.filesChangedCount} unique files changed\n${commitCount} commits tracked\nClick to stop`;
            this.statusBarItem.command = 'codetrace.stopRecording';
        } else {
            this.statusBarItem.text = '$(circle-outline) CodeTrace: Stopped';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = 'Click to start recording';
            this.statusBarItem.command = 'codetrace.startRecording';
        }
    }

    /**
     * Starts a new recording session.
     */
    public async startRecording(): Promise<void> {
        if (this.isRecording) {
            vscode.window.showWarningMessage('CodeTrace: Already recording!');
            return;
        }

        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage(
                'CodeTrace: Please open a workspace folder before recording.'
            );
            return;
        }

        // Initialize git tracking (will gracefully handle non-git repos)
        const gitAvailable = await this.gitTracker.initialize(workspaceRoot.fsPath);

        // Create new session
        this.currentSession = {
            sessionId: generateUUID(),
            startTime: new Date().toISOString(),
            repository: gitAvailable ? this.gitTracker.getRepoName() : undefined,
            changes: [],
            commits: []
        };

        // Reset counters
        this.filesChangedCount = 0;
        this.uniqueFilesChanged.clear();

        // Set recording state
        this.isRecording = true;
        
        // Set up file save listener
        this.setupSaveListener();
        
        // Start git tracking if available
        if (gitAvailable) {
            this.gitTracker.startTracking((commit) => {
                this.recordCommit(commit);
            });
        }
        
        // Update status bar
        this.updateStatusBar();

        console.log('CodeTrace: Recording started', {
            sessionId: this.currentSession.sessionId,
            startTime: this.currentSession.startTime,
            gitEnabled: gitAvailable,
            repository: this.currentSession.repository
        });

        // Build info message
        let message = `CodeTrace: Recording started`;
        if (gitAvailable) {
            message += ` (Git: ${this.gitTracker.getRepoName()})`;
        } else {
            message += ' (Git tracking not available)';
        }
        vscode.window.showInformationMessage(message);
    }

    /**
     * Sets up the file save listener.
     */
    private setupSaveListener(): void {
        this.saveListener = vscode.workspace.onDidSaveTextDocument(
            async (document: vscode.TextDocument) => {
                await this.recordFileSave(document);
            }
        );
    }

    /**
     * Records a file save event to the current session.
     */
    private async recordFileSave(document: vscode.TextDocument): Promise<void> {
        if (!this.currentSession || !this.isRecording) {
            return;
        }

        try {
            const absolutePath = document.uri.fsPath;
            const relativePath = getRelativePath(absolutePath);

            // Skip .codetrace folder
            if (relativePath.startsWith('.codetrace')) {
                return;
            }

            const content = document.getText();

            const fileChange: FileChange = {
                file: relativePath,
                timestamp: new Date().toISOString(),
                content: content
            };

            this.currentSession.changes.push(fileChange);

            // Update unique files count
            if (!this.uniqueFilesChanged.has(relativePath)) {
                this.uniqueFilesChanged.add(relativePath);
                this.filesChangedCount = this.uniqueFilesChanged.size;
                this.updateStatusBar();
            }

            console.log('CodeTrace: File save recorded', {
                file: relativePath,
                timestamp: fileChange.timestamp
            });

        } catch (error) {
            console.error('CodeTrace: Error recording file save', error);
        }
    }

    /**
     * Records a git commit to the current session.
     * Called by GitTracker when a new commit is detected.
     */
    private recordCommit(commit: CommitInfo): void {
        if (!this.currentSession || !this.isRecording) {
            return;
        }

        this.currentSession.commits.push(commit);
        this.updateStatusBar();

        console.log('CodeTrace: Commit recorded', {
            hash: commit.hash.substring(0, 7),
            message: commit.message.substring(0, 50)
        });
    }

    /**
     * Stops the current recording session.
     */
    public async stopRecording(): Promise<void> {
        if (!this.isRecording) {
            vscode.window.showWarningMessage('CodeTrace: Not currently recording!');
            return;
        }

        // Stop git tracking
        this.gitTracker.stopTracking();

        // Clean up save listener
        if (this.saveListener) {
            this.saveListener.dispose();
            this.saveListener = null;
        }

        // Finalize session
        if (this.currentSession) {
            this.currentSession.endTime = new Date().toISOString();
            
            // Calculate stats
            this.currentSession.stats = {
                filesChanged: this.filesChangedCount,
                commitsCount: this.currentSession.commits.length,
                duration: calculateDuration(
                    this.currentSession.startTime,
                    this.currentSession.endTime
                )
            };

            // Save to file
            const saved = await this.saveSessionToFile();

            console.log('CodeTrace: Recording stopped', {
                sessionId: this.currentSession.sessionId,
                stats: this.currentSession.stats
            });

            if (saved) {
                vscode.window.showInformationMessage(
                    `CodeTrace: Recording stopped. ${this.filesChangedCount} files, ${this.currentSession.commits.length} commits, ${this.currentSession.stats.duration} minutes.`
                );
            } else {
                vscode.window.showWarningMessage(
                    `CodeTrace: Recording stopped but failed to save session file.`
                );
            }
        }

        // Reset state
        this.isRecording = false;
        this.currentSession = null;
        this.filesChangedCount = 0;
        this.uniqueFilesChanged.clear();
        
        this.updateStatusBar();
    }

    /**
     * Saves the current session data to a JSON file.
     */
    private async saveSessionToFile(): Promise<boolean> {
        if (!this.currentSession) {
            return false;
        }

        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            console.error('CodeTrace: No workspace root found');
            return false;
        }

        try {
            // Create .codetrace directory
            const codetraceDir = vscode.Uri.joinPath(workspaceRoot, '.codetrace');
            
            try {
                await vscode.workspace.fs.createDirectory(codetraceDir);
            } catch {
                // Directory might already exist
            }

            // Generate filename with timestamp
            const timestamp = this.currentSession.startTime
                .replace(/:/g, '-')
                .replace(/\./g, '-');
            const filename = `session-${timestamp}.json`;
            const filePath = vscode.Uri.joinPath(codetraceDir, filename);

            // Write JSON file
            const jsonContent = JSON.stringify(this.currentSession, null, 2);
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(filePath, encoder.encode(jsonContent));

            console.log('CodeTrace: Session saved to', filePath.fsPath);
            return true;

        } catch (error) {
            console.error('CodeTrace: Error saving session file', error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(
                    `CodeTrace: Failed to save session: ${error.message}`
                );
            }
            return false;
        }
    }

    /**
     * Shows session stats in a quick pick menu.
     * Displays current or last session information.
     */
    public async showSessionStats(): Promise<void> {
        const session = this.currentSession;

        if (!session) {
            // Try to load the most recent session from files
            const recentSession = await this.loadMostRecentSession();
            if (recentSession) {
                await this.displaySessionStats(recentSession, false);
            } else {
                vscode.window.showInformationMessage(
                    'CodeTrace: No active session and no previous sessions found.'
                );
            }
            return;
        }

        await this.displaySessionStats(session, true);
    }

    /**
     * Displays session stats in a quick pick menu.
     */
    private async displaySessionStats(session: SessionData, isActive: boolean): Promise<void> {
        // Calculate duration
        const endTime = session.endTime || new Date().toISOString();
        const duration = calculateDuration(session.startTime, endTime);

        // Build quick pick items
        const items: vscode.QuickPickItem[] = [
            {
                label: '$(info) Session Info',
                description: `ID: ${session.sessionId.substring(0, 8)}...`,
                detail: isActive ? '🔴 Currently Recording' : '⏹️ Completed'
            },
            {
                label: '$(repo) Repository',
                description: session.repository || 'Not a git repository',
                detail: session.repository ? 'Git tracking enabled' : 'Git tracking disabled'
            },
            {
                label: '$(clock) Duration',
                description: `${duration} minutes`,
                detail: `Started: ${new Date(session.startTime).toLocaleString()}`
            },
            {
                label: '$(file) Files Changed',
                description: `${session.stats?.filesChanged || this.filesChangedCount} unique files`,
                detail: `Total saves: ${session.changes.length}`
            },
            {
                label: '$(git-commit) Commits',
                description: `${session.commits.length} commits tracked`,
                detail: session.commits.length > 0 
                    ? `Latest: ${session.commits[session.commits.length - 1]?.message.substring(0, 40)}...`
                    : 'No commits during this session'
            }
        ];

        // Add recent files section
        if (session.changes.length > 0) {
            items.push({
                label: '$(list-tree) Recent Files',
                kind: vscode.QuickPickItemKind.Separator
            } as vscode.QuickPickItem);

            // Get last 5 unique files
            const recentFiles = [...new Set(session.changes.slice(-10).map(c => c.file))].slice(-5);
            for (const file of recentFiles) {
                items.push({
                    label: `    $(file-code) ${path.basename(file)}`,
                    description: path.dirname(file),
                    detail: ''
                });
            }
        }

        // Add recent commits section
        if (session.commits.length > 0) {
            items.push({
                label: '$(git-commit) Recent Commits',
                kind: vscode.QuickPickItemKind.Separator
            } as vscode.QuickPickItem);

            // Get last 3 commits
            const recentCommits = session.commits.slice(-3);
            for (const commit of recentCommits) {
                items.push({
                    label: `    $(git-commit) ${commit.hash.substring(0, 7)}`,
                    description: commit.message.substring(0, 50),
                    detail: `by ${commit.author}`
                });
            }
        }

        // Show the quick pick
        await vscode.window.showQuickPick(items, {
            title: isActive ? 'CodeTrace: Current Session Stats' : 'CodeTrace: Last Session Stats',
            placeHolder: 'Session information',
            canPickMany: false
        });
    }

    /**
     * Loads the most recent session from the .codetrace folder.
     */
    private async loadMostRecentSession(): Promise<SessionData | null> {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            return null;
        }

        try {
            const codetraceDir = vscode.Uri.joinPath(workspaceRoot, '.codetrace');
            
            // List files in .codetrace directory
            const files = await vscode.workspace.fs.readDirectory(codetraceDir);
            
            // Filter for session JSON files and sort by name (which includes timestamp)
            const sessionFiles = files
                .filter(([name, type]) => 
                    type === vscode.FileType.File && 
                    name.startsWith('session-') && 
                    name.endsWith('.json')
                )
                .map(([name]) => name)
                .sort()
                .reverse();

            if (sessionFiles.length === 0) {
                return null;
            }

            // Load the most recent session
            const mostRecentFile = vscode.Uri.joinPath(codetraceDir, sessionFiles[0]);
            const data = await vscode.workspace.fs.readFile(mostRecentFile);
            const decoder = new TextDecoder();
            const session: SessionData = JSON.parse(decoder.decode(data));

            return session;

        } catch (error) {
            console.log('CodeTrace: Could not load recent session', error);
            return null;
        }
    }

    /**
     * Returns the current session data.
     */
    public getCurrentSession(): SessionData | null {
        return this.currentSession;
    }

    /**
     * Returns whether currently recording.
     */
    public getIsRecording(): boolean {
        return this.isRecording;
    }

    /**
     * Cleans up resources.
     */
    public async dispose(): Promise<void> {
        if (this.isRecording) {
            await this.stopRecording();
        }
        this.gitTracker.dispose();
        this.statusBarItem.dispose();
    }
}

// ============================================================================
// EXTENSION ACTIVATION
// ============================================================================

let recordingManager: RecordingManager;
let aiService: AIService;

/**
 * Extension activation function.
 */
export function activate(context: vscode.ExtensionContext): void {
    console.log('CodeTrace: Extension is now activating...');

    // Create recording manager and AI service
    recordingManager = new RecordingManager();
    aiService = new AIService();

    // Register commands
    const startCommand = vscode.commands.registerCommand(
        'codetrace.startRecording',
        async () => {
            await recordingManager.startRecording();
        }
    );

    const stopCommand = vscode.commands.registerCommand(
        'codetrace.stopRecording',
        async () => {
            await recordingManager.stopRecording();
        }
    );

    // Register the "View Session Stats" command
    const statsCommand = vscode.commands.registerCommand(
        'codetrace.viewSessionStats',
        async () => {
            await recordingManager.showSessionStats();
        }
    );

    // Register the "Open Session Timeline" command
    const timelineCommand = vscode.commands.registerCommand(
        'codetrace.openTimeline',
        () => {
            SessionTimelinePanel.createOrShow(context.extensionUri);
        }
    );

    // Register the "Generate Session Summary" command
    const summaryCommand = vscode.commands.registerCommand(
        'codetrace.generateSummary',
        async () => {
            await generateSessionSummary(context);
        }
    );

    // Add to subscriptions
    context.subscriptions.push(startCommand);
    context.subscriptions.push(stopCommand);
    context.subscriptions.push(statsCommand);
    context.subscriptions.push(timelineCommand);
    context.subscriptions.push(summaryCommand);
    context.subscriptions.push({
        dispose: async () => {
            await recordingManager.dispose();
            aiService.dispose();
        }
    });

    console.log('CodeTrace: Extension activated successfully!');
}

/**
 * Generate AI summary for a selected session
 * @param _context - Extension context (reserved for future use)
 */
async function generateSessionSummary(_context: vscode.ExtensionContext): Promise<void> {
    // Load available sessions
    const sessions = await loadAllSessions();
    
    if (sessions.length === 0) {
        vscode.window.showInformationMessage(
            'CodeTrace: No recorded sessions found. Start recording first!'
        );
        return;
    }

    // Let user pick a session
    const items = sessions.map(s => ({
        label: new Date(s.startTime).toLocaleString(),
        description: s.summary?.suggestedTitle || `${s.changes.length} changes, ${s.commits.length} commits`,
        detail: s.summary ? '✨ Has AI Summary' : 'No summary yet',
        session: s
    }));

    const selected = await vscode.window.showQuickPick(items, {
        title: 'Select Session to Summarize',
        placeHolder: 'Choose a session to generate AI summary'
    });

    if (!selected) {
        return;
    }

    // Check if already has summary
    if (selected.session.summary) {
        const action = await vscode.window.showQuickPick(
            ['Regenerate Summary', 'View Existing Summary', 'Cancel'],
            { placeHolder: 'This session already has a summary' }
        );
        
        if (action === 'View Existing Summary') {
            showSummary(selected.session.summary);
            return;
        }
        if (action !== 'Regenerate Summary') {
            return;
        }
    }

    // Show loading indicator
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'CodeTrace: Generating AI Summary...',
        cancellable: false
    }, async (progress) => {
        progress.report({ increment: 0, message: 'Analyzing session...' });

        // Generate summary
        const summary = await aiService.generateSessionSummary(selected.session);
        
        if (!summary) {
            return;
        }

        progress.report({ increment: 50, message: 'Saving summary...' });

        // Update session with summary
        selected.session.summary = summary;
        
        // Save updated session
        const saved = await saveSessionWithSummary(selected.session);
        
        progress.report({ increment: 100, message: 'Done!' });

        if (saved) {
            // Show the generated summary
            showSummary(summary);
            
            vscode.window.showInformationMessage(
                `CodeTrace: Summary generated! "${summary.suggestedTitle}"`
            );
        }
    });
}

/**
 * Load all sessions from .codetrace folder
 */
async function loadAllSessions(): Promise<SessionData[]> {
    const workspaceRoot = getWorkspaceRoot();
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
 * Save session with updated summary
 */
async function saveSessionWithSummary(session: SessionData): Promise<boolean> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return false;
    }

    try {
        const codetraceDir = vscode.Uri.joinPath(workspaceRoot, '.codetrace');
        
        // Generate filename from session start time
        const timestamp = session.startTime
            .replace(/:/g, '-')
            .replace(/\./g, '-');
        const filename = `session-${timestamp}.json`;
        const filePath = vscode.Uri.joinPath(codetraceDir, filename);

        // Write updated session
        const jsonContent = JSON.stringify(session, null, 2);
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(filePath, encoder.encode(jsonContent));

        return true;
    } catch (error) {
        console.error('CodeTrace: Error saving session with summary', error);
        return false;
    }
}

/**
 * Display summary in a nice format
 */
function showSummary(summary: SessionSummary): void {
    const items: vscode.QuickPickItem[] = [
        {
            label: '📝 ' + summary.suggestedTitle,
            kind: vscode.QuickPickItemKind.Separator
        } as vscode.QuickPickItem,
        {
            label: '$(lightbulb) What Was Built',
            description: summary.whatWasBuilt,
            detail: ''
        },
        {
            label: '$(target) Apparent Goal',
            description: summary.apparentGoal,
            detail: ''
        },
        {
            label: '$(file) Key Files Modified',
            description: summary.keyFilesModified.slice(0, 5).join(', '),
            detail: summary.keyFilesModified.length > 5 
                ? `... and ${summary.keyFilesModified.length - 5} more`
                : ''
        },
        {
            label: '$(info) Generated',
            description: new Date(summary.generatedAt).toLocaleString(),
            detail: `Model: ${summary.model}`
        }
    ];

    vscode.window.showQuickPick(items, {
        title: `AI Summary: ${summary.suggestedTitle}`,
        placeHolder: 'Session summary'
    });
}

/**
 * Extension deactivation function.
 */
export function deactivate(): void {
    console.log('CodeTrace: Extension is deactivating...');
}
