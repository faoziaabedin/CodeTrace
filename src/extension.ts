/**
 * CodeTrace - Smart Coding Session Recorder
 * 
 * Hey! This is my VS Code extension that records your coding sessions.
 * I built this because I wanted a way to track what I work on and
 * get AI-powered insights about my coding patterns.
 * 
 * Main features:
 * - Records file saves with timestamps and content snapshots
 * - Tracks git commits made during sessions
 * - Generates AI summaries using OpenAI
 * - Exports sessions as markdown reports
 * 
 * The architecture is pretty simple:
 * - RecordingManager handles all the recording logic
 * - GitTracker monitors git commits using simple-git
 * - AIService generates summaries via OpenAI API
 * - SessionTimelinePanel renders the webview UI
 * 
 * @author Faozia Abedin
 * @license MIT
 */

import * as vscode from 'vscode';
import * as path from 'path';
import simpleGit, { SimpleGit, LogResult } from 'simple-git';
import { SessionTimelinePanel } from './SessionTimelinePanel';
import { AIService, SessionSummary } from './AIService';

// ============================================================================
// TYPE DEFINITIONS
// I like keeping these at the top so it's easy to see the data structures
// ============================================================================

/**
 * Represents a single file change - basically a snapshot of a file at a moment in time.
 * I store the full content because I want to be able to see exactly what changed.
 */
interface FileChange {
    file: string;       // relative path from workspace root
    timestamp: string;  // ISO format - makes sorting easy
    content: string;    // full file content at save time
}

/**
 * Git commit info - keeping it simple with just the essentials
 */
interface CommitInfo {
    hash: string;
    message: string;
    author: string;
    timestamp: string;
}

/**
 * Stats calculated at the end of a session - useful for quick overviews
 */
interface SessionStats {
    filesChanged: number;
    commitsCount: number;
    duration: string;  // in minutes
}

/**
 * The main session object - this is what gets saved to JSON
 * I tried to keep it flat and simple to make it easy to work with
 */
interface SessionData {
    sessionId: string;
    startTime: string;
    endTime?: string;
    repository?: string;
    changes: FileChange[];
    commits: CommitInfo[];
    stats?: SessionStats;
    summary?: SessionSummary;
}

// ============================================================================
// UTILITY FUNCTIONS
// Small helper functions that I use throughout the extension
// ============================================================================

/**
 * Generates a UUID - I'm using the simple approach here since we don't need
 * cryptographic randomness, just unique IDs for sessions
 */
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Gets the first workspace folder - for now I'm only supporting single-root workspaces
 * Multi-root support could be added later if needed
 */
function getWorkspaceRoot(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri : undefined;
}

/**
 * Converts absolute paths to relative - makes the data more portable
 * and easier to read in the UI
 */
function getRelativePath(absolutePath: string): string {
    const workspaceRoot = getWorkspaceRoot();
    if (workspaceRoot) {
        const relativePath = path.relative(workspaceRoot.fsPath, absolutePath);
        return relativePath.replace(/\\/g, '/'); // normalize for Windows
    }
    return absolutePath;
}

/**
 * Simple duration calculator - returns minutes as a string
 */
function calculateDuration(startTime: string, endTime: string): string {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const minutes = Math.round((end - start) / 60000);
    return `${minutes}`;
}

/**
 * Checks if a file should be ignored based on user settings
 * Uses minimatch-style glob patterns
 */
function shouldIgnoreFile(filePath: string): boolean {
    const config = vscode.workspace.getConfiguration('codetrace');
    const ignorePatterns = config.get<string[]>('ignorePatterns') || [];
    
    // Simple glob matching - checks if path contains any of the patterns
    for (const pattern of ignorePatterns) {
        // Handle ** patterns
        const regexPattern = pattern
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\./g, '\\.');
        
        if (new RegExp(regexPattern).test(filePath)) {
            return true;
        }
    }
    return false;
}

/**
 * Shows a notification only if enabled in settings
 * I added this because some people find notifications annoying
 */
function showNotification(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
    const config = vscode.workspace.getConfiguration('codetrace');
    if (!config.get<boolean>('showNotifications')) {
        return;
    }
    
    switch (type) {
        case 'warning':
            vscode.window.showWarningMessage(message);
            break;
        case 'error':
            vscode.window.showErrorMessage(message);
            break;
        default:
            vscode.window.showInformationMessage(message);
    }
}

// ============================================================================
// GIT TRACKER CLASS
// Handles all the git-related stuff using simple-git library
// ============================================================================

class GitTracker {
    private git: SimpleGit | null = null;
    private isGitRepo: boolean = false;
    private repoName: string = '';
    private lastSeenCommitHash: string = '';
    private pollInterval: NodeJS.Timeout | null = null;
    private onCommitCallback: ((commit: CommitInfo) => void) | null = null;

    /**
     * Initializes git tracking for the workspace
     * Returns false if git isn't available or it's not a repo
     */
    async initialize(workspacePath: string): Promise<boolean> {
        try {
            // Set up simple-git with our workspace
            this.git = simpleGit({
                baseDir: workspacePath,
                binary: 'git',
                maxConcurrentProcesses: 1,
                trimmed: true
            });

            // Check if this is actually a git repo
            const isRepo = await this.git.checkIsRepo();
            if (!isRepo) {
                console.log('CodeTrace: Not a git repository - git tracking disabled');
                this.isGitRepo = false;
                return false;
            }

            this.isGitRepo = true;
            await this.fetchRepoName(workspacePath);
            await this.fetchLastCommitHash();

            console.log(`CodeTrace: Git initialized for ${this.repoName}`);
            return true;

        } catch (error) {
            // Git probably isn't installed - that's okay, we just won't track commits
            console.log('CodeTrace: Git not available:', error);
            this.isGitRepo = false;
            return false;
        }
    }

    /**
     * Gets the repo name from the remote URL or falls back to folder name
     */
    private async fetchRepoName(workspacePath: string): Promise<void> {
        if (!this.git) return;

        try {
            const remotes = await this.git.getRemotes(true);
            const origin = remotes.find(r => r.name === 'origin');
            
            if (origin?.refs.fetch) {
                // Extract repo name from URL like github.com/user/repo.git
                const match = origin.refs.fetch.match(/\/([^/]+?)(\.git)?$/);
                if (match) {
                    this.repoName = match[1];
                    return;
                }
            }
        } catch (error) {
            console.log('CodeTrace: Could not get remote URL');
        }

        // Fallback to folder name
        this.repoName = path.basename(workspacePath);
    }

    /**
     * Gets the latest commit hash so we know where to start tracking from
     */
    private async fetchLastCommitHash(): Promise<void> {
        if (!this.git) return;

        try {
            const log = await this.git.log({ maxCount: 1 });
            if (log.latest) {
                this.lastSeenCommitHash = log.latest.hash;
            }
        } catch {
            // No commits yet - that's fine
            this.lastSeenCommitHash = '';
        }
    }

    /**
     * Starts polling for new commits every 5 seconds
     * I chose polling because it's simpler than watching .git/refs
     */
    startTracking(onCommit: (commit: CommitInfo) => void): void {
        if (!this.isGitRepo || !this.git) return;

        this.onCommitCallback = onCommit;
        this.pollInterval = setInterval(async () => {
            await this.checkForNewCommits();
        }, 5000);

        console.log('CodeTrace: Git tracking started');
    }

    /**
     * Checks for commits made since we last looked
     */
    private async checkForNewCommits(): Promise<void> {
        if (!this.git || !this.onCommitCallback) return;

        try {
            const log: LogResult = await this.git.log({ maxCount: 10 });
            const newCommits: CommitInfo[] = [];
            
            // Find commits we haven't seen yet
            for (const commit of log.all) {
                if (commit.hash === this.lastSeenCommitHash) break;
                
                newCommits.push({
                    hash: commit.hash,
                    message: commit.message,
                    author: commit.author_name,
                    timestamp: new Date(commit.date).toISOString()
                });
            }

            // Process in chronological order (oldest first)
            newCommits.reverse();
            for (const commit of newCommits) {
                console.log(`CodeTrace: New commit detected - ${commit.hash.substring(0, 7)}`);
                this.onCommitCallback(commit);
            }

            // Update our checkpoint
            if (log.latest) {
                this.lastSeenCommitHash = log.latest.hash;
            }

        } catch (error) {
            console.error('CodeTrace: Error checking for commits:', error);
        }
    }

    stopTracking(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.onCommitCallback = null;
    }

    isAvailable(): boolean {
        return this.isGitRepo;
    }

    getRepoName(): string {
        return this.repoName;
    }

    dispose(): void {
        this.stopTracking();
        this.git = null;
    }
}

// ============================================================================
// RECORDING MANAGER CLASS
// This is the heart of the extension - manages the whole recording lifecycle
// ============================================================================

class RecordingManager {
    private statusBarItem: vscode.StatusBarItem;
    private isRecording: boolean = false;
    private currentSession: SessionData | null = null;
    private saveListener: vscode.Disposable | null = null;
    private gitTracker: GitTracker;
    private filesChangedCount: number = 0;
    private uniqueFilesChanged: Set<string> = new Set();

    constructor() {
        // Create status bar item - I put it on the left with high priority
        // so it's always visible and easy to click
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        
        this.gitTracker = new GitTracker();
        this.updateStatusBar();
        this.statusBarItem.show();
    }

    /**
     * Updates the status bar with current recording state
     * Shows file and commit counts when recording
     */
    private updateStatusBar(): void {
        if (this.isRecording) {
            const commitCount = this.currentSession?.commits.length || 0;
            this.statusBarItem.text = `$(record) Recording (${this.filesChangedCount} files, ${commitCount} commits)`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.statusBarItem.tooltip = 'Click to stop recording';
            this.statusBarItem.command = 'codetrace.stopRecording';
        } else {
            this.statusBarItem.text = '$(circle-outline) CodeTrace';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = 'Click to start recording';
            this.statusBarItem.command = 'codetrace.startRecording';
        }
    }

    /**
     * Starts a new recording session
     * Sets up file watchers and git tracking
     */
    public async startRecording(): Promise<void> {
        if (this.isRecording) {
            showNotification('Already recording!', 'warning');
            return;
        }

        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            showNotification('Please open a folder before recording', 'error');
            return;
        }

        // Initialize git tracking (okay if it fails)
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
        this.isRecording = true;

        // Set up listeners
        this.setupSaveListener();
        
        if (gitAvailable) {
            this.gitTracker.startTracking((commit) => this.recordCommit(commit));
        }
        
        // Update context for keybinding conditions
        vscode.commands.executeCommand('setContext', 'codetrace.isRecording', true);
        
        this.updateStatusBar();

        console.log(`CodeTrace: Recording started - Session ${this.currentSession.sessionId}`);
        showNotification(`Recording started${gitAvailable ? ` (Git: ${this.gitTracker.getRepoName()})` : ''}`);
    }

    /**
     * Listens for file saves using VS Code's workspace API
     * This is more reliable than file system watchers
     */
    private setupSaveListener(): void {
        this.saveListener = vscode.workspace.onDidSaveTextDocument(
            async (document: vscode.TextDocument) => {
                await this.recordFileSave(document);
            }
        );
    }

    /**
     * Records a file save to the current session
     * Includes full content snapshot for later review
     */
    private async recordFileSave(document: vscode.TextDocument): Promise<void> {
        if (!this.currentSession || !this.isRecording) return;

        try {
            const absolutePath = document.uri.fsPath;
            const relativePath = getRelativePath(absolutePath);

            // Skip ignored files
            if (shouldIgnoreFile(relativePath)) {
                return;
            }

            const content = document.getText();

            this.currentSession.changes.push({
                file: relativePath,
                timestamp: new Date().toISOString(),
                content: content
            });

            // Track unique files for the status bar
            if (!this.uniqueFilesChanged.has(relativePath)) {
                this.uniqueFilesChanged.add(relativePath);
                this.filesChangedCount = this.uniqueFilesChanged.size;
                this.updateStatusBar();
            }

            console.log(`CodeTrace: Recorded save - ${relativePath}`);

        } catch (error) {
            console.error('CodeTrace: Error recording file save:', error);
        }
    }

    /**
     * Records a git commit to the session
     */
    private recordCommit(commit: CommitInfo): void {
        if (!this.currentSession || !this.isRecording) return;
        
        this.currentSession.commits.push(commit);
        this.updateStatusBar();
        console.log(`CodeTrace: Recorded commit - ${commit.hash.substring(0, 7)}`);
    }

    /**
     * Stops recording and saves the session
     * Optionally generates an AI summary if enabled
     */
    public async stopRecording(): Promise<void> {
        if (!this.isRecording) {
            showNotification('Not currently recording', 'warning');
            return;
        }

        // Clean up listeners
        this.gitTracker.stopTracking();
        if (this.saveListener) {
            this.saveListener.dispose();
            this.saveListener = null;
        }

        // Finalize session
        if (this.currentSession) {
            this.currentSession.endTime = new Date().toISOString();
            this.currentSession.stats = {
                filesChanged: this.filesChangedCount,
                commitsCount: this.currentSession.commits.length,
                duration: calculateDuration(this.currentSession.startTime, this.currentSession.endTime)
            };

            // Save to file
            const saved = await this.saveSessionToFile();

            console.log(`CodeTrace: Recording stopped - ${this.filesChangedCount} files, ${this.currentSession.commits.length} commits`);

            if (saved) {
                showNotification(
                    `Recording saved! ${this.filesChangedCount} files, ${this.currentSession.commits.length} commits, ${this.currentSession.stats.duration} min`
                );

                // Auto-generate summary if enabled
                const config = vscode.workspace.getConfiguration('codetrace');
                if (config.get<boolean>('autoGenerateSummary')) {
                    vscode.commands.executeCommand('codetrace.generateSummary');
                }
            }
        }

        // Reset state
        this.isRecording = false;
        this.currentSession = null;
        this.filesChangedCount = 0;
        this.uniqueFilesChanged.clear();
        
        vscode.commands.executeCommand('setContext', 'codetrace.isRecording', false);
        this.updateStatusBar();
    }

    /**
     * Saves session data to a JSON file in .codetrace folder
     */
    private async saveSessionToFile(): Promise<boolean> {
        if (!this.currentSession) return false;

        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) return false;

        try {
            const codetraceDir = vscode.Uri.joinPath(workspaceRoot, '.codetrace');
            
            // Create directory if needed
            try {
                await vscode.workspace.fs.createDirectory(codetraceDir);
            } catch {
                // Directory exists - that's fine
            }

            // Clean up old sessions if we have too many
            await this.cleanupOldSessions(codetraceDir);

            // Generate filename from timestamp
            const timestamp = this.currentSession.startTime
                .replace(/:/g, '-')
                .replace(/\./g, '-');
            const filename = `session-${timestamp}.json`;
            const filePath = vscode.Uri.joinPath(codetraceDir, filename);

            // Write the file
            const jsonContent = JSON.stringify(this.currentSession, null, 2);
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(filePath, encoder.encode(jsonContent));

            console.log(`CodeTrace: Session saved to ${filename}`);
            return true;

        } catch (error) {
            console.error('CodeTrace: Error saving session:', error);
            showNotification('Failed to save session', 'error');
            return false;
        }
    }

    /**
     * Removes old sessions if we have more than the configured limit
     */
    private async cleanupOldSessions(codetraceDir: vscode.Uri): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('codetrace');
            const maxSessions = config.get<number>('maxSessionsToKeep') || 50;

            const files = await vscode.workspace.fs.readDirectory(codetraceDir);
            const sessionFiles = files
                .filter(([name, type]) => 
                    type === vscode.FileType.File && 
                    name.startsWith('session-') && 
                    name.endsWith('.json')
                )
                .map(([name]) => name)
                .sort();

            // Delete oldest files if we're over the limit
            while (sessionFiles.length >= maxSessions) {
                const oldest = sessionFiles.shift();
                if (oldest) {
                    const filePath = vscode.Uri.joinPath(codetraceDir, oldest);
                    await vscode.workspace.fs.delete(filePath);
                    console.log(`CodeTrace: Deleted old session ${oldest}`);
                }
            }
        } catch (error) {
            console.error('CodeTrace: Error cleaning up old sessions:', error);
        }
    }

    /**
     * Shows quick stats for current or recent session
     */
    public async showSessionStats(): Promise<void> {
        const session = this.currentSession || await this.loadMostRecentSession();

        if (!session) {
            showNotification('No sessions found. Start recording first!');
            return;
        }

        await this.displaySessionStats(session, !!this.currentSession);
    }

    private async displaySessionStats(session: SessionData, isActive: boolean): Promise<void> {
        const endTime = session.endTime || new Date().toISOString();
        const duration = calculateDuration(session.startTime, endTime);

        const items: vscode.QuickPickItem[] = [
            {
                label: '$(info) Session Info',
                description: `ID: ${session.sessionId.substring(0, 8)}...`,
                detail: isActive ? '🔴 Currently Recording' : '✅ Completed'
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
                description: `${session.commits.length} commits`,
                detail: session.commits.length > 0 
                    ? `Latest: ${session.commits[session.commits.length - 1]?.message.substring(0, 40)}...`
                    : 'No commits in this session'
            }
        ];

        if (session.summary) {
            items.push({
                label: '$(sparkle) AI Summary',
                description: session.summary.suggestedTitle,
                detail: session.summary.whatWasBuilt.substring(0, 80) + '...'
            });
        }

        await vscode.window.showQuickPick(items, {
            title: isActive ? 'Current Session' : 'Last Session',
            placeHolder: 'Session statistics'
        });
    }

    private async loadMostRecentSession(): Promise<SessionData | null> {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) return null;

        try {
            const codetraceDir = vscode.Uri.joinPath(workspaceRoot, '.codetrace');
            const files = await vscode.workspace.fs.readDirectory(codetraceDir);
            
            const sessionFiles = files
                .filter(([name, type]) => 
                    type === vscode.FileType.File && 
                    name.startsWith('session-') && 
                    name.endsWith('.json')
                )
                .map(([name]) => name)
                .sort()
                .reverse();

            if (sessionFiles.length === 0) return null;

            const filePath = vscode.Uri.joinPath(codetraceDir, sessionFiles[0]);
            const data = await vscode.workspace.fs.readFile(filePath);
            return JSON.parse(new TextDecoder().decode(data));

        } catch {
            return null;
        }
    }

    public getCurrentSession(): SessionData | null {
        return this.currentSession;
    }

    public getIsRecording(): boolean {
        return this.isRecording;
    }

    public async dispose(): Promise<void> {
        if (this.isRecording) {
            await this.stopRecording();
        }
        this.gitTracker.dispose();
        this.statusBarItem.dispose();
    }
}

// ============================================================================
// MODULE-LEVEL INSTANCES
// ============================================================================

let recordingManager: RecordingManager;
let aiService: AIService;

// ============================================================================
// EXTENSION ACTIVATION
// This is where everything gets wired up when VS Code loads the extension
// ============================================================================

export function activate(context: vscode.ExtensionContext): void {
    console.log('CodeTrace: Activating extension...');

    // Initialize our main components
    recordingManager = new RecordingManager();
    aiService = new AIService();

    // Register all the commands
    const commands = [
        vscode.commands.registerCommand('codetrace.startRecording', () => 
            recordingManager.startRecording()
        ),
        vscode.commands.registerCommand('codetrace.stopRecording', () => 
            recordingManager.stopRecording()
        ),
        vscode.commands.registerCommand('codetrace.viewSessionStats', () => 
            recordingManager.showSessionStats()
        ),
        vscode.commands.registerCommand('codetrace.openTimeline', () => 
            SessionTimelinePanel.createOrShow(context.extensionUri)
        ),
        vscode.commands.registerCommand('codetrace.generateSummary', () => 
            generateSessionSummary()
        ),
        vscode.commands.registerCommand('codetrace.exportMarkdown', () => 
            exportSessionAsMarkdown()
        ),
        vscode.commands.registerCommand('codetrace.deleteSession', () => 
            deleteSession()
        ),
        vscode.commands.registerCommand('codetrace.openSettings', () => 
            vscode.commands.executeCommand('workbench.action.openSettings', 'codetrace')
        )
    ];

    // Add all commands to subscriptions for cleanup
    commands.forEach(cmd => context.subscriptions.push(cmd));

    // Cleanup on deactivation
    context.subscriptions.push({
        dispose: async () => {
            await recordingManager.dispose();
            aiService.dispose();
        }
    });

    // Auto-start recording if enabled
    const config = vscode.workspace.getConfiguration('codetrace');
    if (config.get<boolean>('autoRecordOnStart')) {
        recordingManager.startRecording();
    }

    // Track anonymous telemetry
    if (config.get<boolean>('enableTelemetry')) {
        trackActivation();
    }

    console.log('CodeTrace: Extension activated successfully!');
}

export function deactivate(): void {
    console.log('CodeTrace: Deactivating...');
}

// ============================================================================
// COMMAND IMPLEMENTATIONS
// ============================================================================

/**
 * Generates an AI summary for a selected session
 */
async function generateSessionSummary(): Promise<void> {
    const sessions = await loadAllSessions();
    
    if (sessions.length === 0) {
        showNotification('No sessions found. Start recording first!');
        return;
    }

    // Let user pick which session to summarize
    const items = sessions.map(s => ({
        label: s.summary?.suggestedTitle || new Date(s.startTime).toLocaleString(),
        description: `${s.changes.length} changes, ${s.commits.length} commits`,
        detail: s.summary ? '✨ Has AI Summary' : 'No summary',
        session: s
    }));

    const selected = await vscode.window.showQuickPick(items, {
        title: 'Select Session to Summarize',
        placeHolder: 'Choose a session'
    });

    if (!selected) return;

    // Check if already has summary
    if (selected.session.summary) {
        const action = await vscode.window.showQuickPick(
            ['Regenerate', 'View Existing', 'Cancel'],
            { placeHolder: 'This session already has a summary' }
        );
        
        if (action === 'View Existing') {
            showSummary(selected.session.summary);
            return;
        }
        if (action !== 'Regenerate') return;
    }

    // Generate with progress indicator
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Generating AI Summary...',
        cancellable: false
    }, async (progress) => {
        progress.report({ increment: 30, message: 'Analyzing session...' });

        const summary = await aiService.generateSessionSummary(selected.session);
        if (!summary) return;

        progress.report({ increment: 60, message: 'Saving...' });

        selected.session.summary = summary;
        await saveSessionWithSummary(selected.session);

        progress.report({ increment: 100 });
        
        showSummary(summary);
        showNotification(`Summary: "${summary.suggestedTitle}"`);
    });
}

/**
 * Exports a session as a markdown report
 */
async function exportSessionAsMarkdown(): Promise<void> {
    const sessions = await loadAllSessions();
    
    if (sessions.length === 0) {
        showNotification('No sessions to export');
        return;
    }

    const items = sessions.map(s => ({
        label: s.summary?.suggestedTitle || new Date(s.startTime).toLocaleString(),
        description: `${s.changes.length} changes, ${s.commits.length} commits`,
        session: s
    }));

    const selected = await vscode.window.showQuickPick(items, {
        title: 'Export Session as Markdown',
        placeHolder: 'Choose a session'
    });

    if (!selected) return;

    const markdown = generateMarkdownReport(selected.session);

    // Let user choose where to save
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`session-report-${selected.session.sessionId.substring(0, 8)}.md`),
        filters: { 'Markdown': ['md'] }
    });

    if (uri) {
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(markdown));
        showNotification('Report exported!');
        
        // Open the exported file
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
    }
}

/**
 * Generates a markdown report from session data
 */
function generateMarkdownReport(session: SessionData): string {
    const startDate = new Date(session.startTime);
    const endDate = session.endTime ? new Date(session.endTime) : new Date();
    const duration = session.stats?.duration || '?';

    let md = `# Coding Session Report\n\n`;
    md += `**Date:** ${startDate.toLocaleDateString()}\n`;
    md += `**Time:** ${startDate.toLocaleTimeString()} - ${endDate.toLocaleTimeString()}\n`;
    md += `**Duration:** ${duration} minutes\n`;
    md += `**Repository:** ${session.repository || 'N/A'}\n\n`;

    // AI Summary section
    if (session.summary) {
        md += `## 🤖 AI Summary\n\n`;
        md += `### ${session.summary.suggestedTitle}\n\n`;
        md += `**What was built:** ${session.summary.whatWasBuilt}\n\n`;
        md += `**Goal:** ${session.summary.apparentGoal}\n\n`;
        md += `**Key files:** ${session.summary.keyFilesModified.join(', ')}\n\n`;
    }

    // Statistics
    md += `## 📊 Statistics\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Files Changed | ${session.stats?.filesChanged || session.changes.length} |\n`;
    md += `| Total Saves | ${session.changes.length} |\n`;
    md += `| Commits | ${session.commits.length} |\n`;
    md += `| Duration | ${duration} min |\n\n`;

    // Files changed
    md += `## 📁 Files Modified\n\n`;
    const uniqueFiles = [...new Set(session.changes.map(c => c.file))];
    for (const file of uniqueFiles) {
        const saveCount = session.changes.filter(c => c.file === file).length;
        md += `- \`${file}\` (${saveCount} save${saveCount > 1 ? 's' : ''})\n`;
    }
    md += '\n';

    // Commits
    if (session.commits.length > 0) {
        md += `## 📝 Commits\n\n`;
        for (const commit of session.commits) {
            md += `- **${commit.hash.substring(0, 7)}** ${commit.message}\n`;
            md += `  - Author: ${commit.author}\n`;
            md += `  - Time: ${new Date(commit.timestamp).toLocaleString()}\n\n`;
        }
    }

    // Timeline
    md += `## ⏱️ Timeline\n\n`;
    const allEvents = [
        ...session.changes.map(c => ({ type: 'save', time: c.timestamp, desc: `Saved ${c.file}` })),
        ...session.commits.map(c => ({ type: 'commit', time: c.timestamp, desc: `Commit: ${c.message}` }))
    ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    for (const event of allEvents.slice(0, 50)) { // Limit to 50 events
        const time = new Date(event.time).toLocaleTimeString();
        const icon = event.type === 'commit' ? '📝' : '💾';
        md += `- ${time} ${icon} ${event.desc}\n`;
    }

    if (allEvents.length > 50) {
        md += `\n*...and ${allEvents.length - 50} more events*\n`;
    }

    md += `\n---\n*Generated by CodeTrace*\n`;

    return md;
}

/**
 * Deletes a session with confirmation
 */
async function deleteSession(): Promise<void> {
    const sessions = await loadAllSessions();
    
    if (sessions.length === 0) {
        showNotification('No sessions to delete');
        return;
    }

    const items = sessions.map(s => ({
        label: s.summary?.suggestedTitle || new Date(s.startTime).toLocaleString(),
        description: `${s.changes.length} changes`,
        session: s
    }));

    const selected = await vscode.window.showQuickPick(items, {
        title: 'Delete Session',
        placeHolder: 'Select session to delete'
    });

    if (!selected) return;

    // Confirm deletion
    const confirm = await vscode.window.showWarningMessage(
        `Delete session from ${new Date(selected.session.startTime).toLocaleString()}?`,
        { modal: true },
        'Delete'
    );

    if (confirm !== 'Delete') return;

    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return;

    try {
        const codetraceDir = vscode.Uri.joinPath(workspaceRoot, '.codetrace');
        const timestamp = selected.session.startTime.replace(/:/g, '-').replace(/\./g, '-');
        const filename = `session-${timestamp}.json`;
        const filePath = vscode.Uri.joinPath(codetraceDir, filename);

        await vscode.workspace.fs.delete(filePath);
        showNotification('Session deleted');

    } catch (error) {
        showNotification('Failed to delete session', 'error');
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function loadAllSessions(): Promise<SessionData[]> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return [];

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
                sessions.push(JSON.parse(decoder.decode(data)));
            } catch (error) {
                console.error(`CodeTrace: Error loading ${filename}:`, error);
            }
        }

        return sessions;
    } catch {
        return [];
    }
}

async function saveSessionWithSummary(session: SessionData): Promise<boolean> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return false;

    try {
        const codetraceDir = vscode.Uri.joinPath(workspaceRoot, '.codetrace');
        const timestamp = session.startTime.replace(/:/g, '-').replace(/\./g, '-');
        const filename = `session-${timestamp}.json`;
        const filePath = vscode.Uri.joinPath(codetraceDir, filename);

        const jsonContent = JSON.stringify(session, null, 2);
        await vscode.workspace.fs.writeFile(filePath, new TextEncoder().encode(jsonContent));

        return true;
    } catch {
        return false;
    }
}

function showSummary(summary: SessionSummary): void {
    const items: vscode.QuickPickItem[] = [
        {
            label: `📝 ${summary.suggestedTitle}`,
            kind: vscode.QuickPickItemKind.Separator
        } as vscode.QuickPickItem,
        {
            label: '$(lightbulb) What Was Built',
            description: summary.whatWasBuilt
        },
        {
            label: '$(target) Apparent Goal',
            description: summary.apparentGoal
        },
        {
            label: '$(file) Key Files',
            description: summary.keyFilesModified.slice(0, 5).join(', ')
        },
        {
            label: '$(info) Generated',
            description: `${new Date(summary.generatedAt).toLocaleString()} using ${summary.model}`
        }
    ];

    vscode.window.showQuickPick(items, {
        title: `AI Summary: ${summary.suggestedTitle}`,
        placeHolder: 'Summary details'
    });
}

/**
 * Simple telemetry - just tracks that the extension was activated
 * Completely anonymous, no personal data
 */
function trackActivation(): void {
    // This would send to a telemetry service in production
    // For now, just log locally
    console.log('CodeTrace: Telemetry - extension activated');
}
