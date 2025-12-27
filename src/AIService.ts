/**
 * AIService
 * 
 * Handles AI-powered features using OpenAI API.
 * Generates session summaries by analyzing file changes and commits.
 * 
 * Security:
 * - API key stored in VS Code settings (encrypted by VS Code)
 * - Key never logged or exposed
 * - Minimal data sent to API (paths only, not full content)
 */

import * as vscode from 'vscode';
import OpenAI from 'openai';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Structure for AI-generated session summary
 */
export interface SessionSummary {
    /** High-level description of what was built/changed */
    whatWasBuilt: string;
    /** List of key files that were modified */
    keyFilesModified: string[];
    /** The apparent goal or purpose of the session */
    apparentGoal: string;
    /** AI-suggested title for the session */
    suggestedTitle: string;
    /** When the summary was generated */
    generatedAt: string;
    /** Model used to generate the summary */
    model: string;
}

/**
 * Session data structure for AI analysis
 */
interface SessionForAnalysis {
    sessionId: string;
    startTime: string;
    endTime?: string;
    repository?: string;
    changes: Array<{
        file: string;
        timestamp: string;
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

// ============================================================================
// AI SERVICE CLASS
// ============================================================================

export class AIService {
    private openai: OpenAI | null = null;

    /**
     * Initialize OpenAI client with API key from settings
     * @returns true if initialization successful, false otherwise
     */
    private async initializeClient(): Promise<boolean> {
        // Get API key from VS Code settings
        const config = vscode.workspace.getConfiguration('codetrace');
        const apiKey = config.get<string>('openaiApiKey');

        if (!apiKey || apiKey.trim() === '') {
            // Show helpful error with action to open settings
            const action = await vscode.window.showErrorMessage(
                'CodeTrace: OpenAI API key not configured. Please add your API key in settings.',
                'Open Settings'
            );
            
            if (action === 'Open Settings') {
                await vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'codetrace.openaiApiKey'
                );
            }
            return false;
        }

        try {
            // Create OpenAI client
            // Note: API key is not logged anywhere
            this.openai = new OpenAI({
                apiKey: apiKey
            });
            return true;
        } catch (error) {
            console.error('CodeTrace: Failed to initialize OpenAI client');
            vscode.window.showErrorMessage(
                'CodeTrace: Failed to initialize OpenAI client. Please check your API key.'
            );
            return false;
        }
    }

    /**
     * Get the configured AI model
     */
    private getModel(): string {
        const config = vscode.workspace.getConfiguration('codetrace');
        return config.get<string>('aiModel') || 'gpt-4o-mini';
    }

    /**
     * Generate a summary for a coding session
     * @param session - The session data to analyze
     * @returns The generated summary or null if failed
     */
    public async generateSessionSummary(
        session: SessionForAnalysis
    ): Promise<SessionSummary | null> {
        // Initialize client
        const initialized = await this.initializeClient();
        if (!initialized || !this.openai) {
            return null;
        }

        // Prepare the analysis data (minimal data, no file content)
        const analysisData = this.prepareAnalysisData(session);
        
        // Build the prompt
        const prompt = this.buildPrompt(analysisData);

        try {
            const model = this.getModel();
            
            // Call OpenAI API
            const response = await this.openai.chat.completions.create({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: `You are a helpful assistant that analyzes coding sessions and provides concise, insightful summaries. 
                        
Your task is to analyze the file changes and commits from a coding session and generate a summary.

Always respond with valid JSON in exactly this format:
{
    "whatWasBuilt": "A clear, 1-2 sentence description of what was built or changed",
    "keyFilesModified": ["file1.ts", "file2.ts"],
    "apparentGoal": "The likely purpose or goal of this coding session",
    "suggestedTitle": "A short, descriptive title for this session (5 words max)"
}

Focus on:
- Identifying the main purpose of the work
- Highlighting the most important files
- Being concise but informative`
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 500,
                response_format: { type: 'json_object' }
            });

            // Parse the response
            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('Empty response from AI');
            }

            const parsed = JSON.parse(content);

            // Build and return the summary
            const summary: SessionSummary = {
                whatWasBuilt: parsed.whatWasBuilt || 'Unable to determine',
                keyFilesModified: parsed.keyFilesModified || [],
                apparentGoal: parsed.apparentGoal || 'Unable to determine',
                suggestedTitle: parsed.suggestedTitle || 'Coding Session',
                generatedAt: new Date().toISOString(),
                model: model
            };

            return summary;

        } catch (error) {
            // Handle specific error types
            if (error instanceof OpenAI.APIError) {
                if (error.status === 401) {
                    vscode.window.showErrorMessage(
                        'CodeTrace: Invalid OpenAI API key. Please check your settings.'
                    );
                } else if (error.status === 429) {
                    vscode.window.showErrorMessage(
                        'CodeTrace: OpenAI rate limit exceeded. Please try again later.'
                    );
                } else if (error.status === 500) {
                    vscode.window.showErrorMessage(
                        'CodeTrace: OpenAI service error. Please try again later.'
                    );
                } else {
                    vscode.window.showErrorMessage(
                        `CodeTrace: OpenAI API error: ${error.message}`
                    );
                }
            } else if (error instanceof SyntaxError) {
                vscode.window.showErrorMessage(
                    'CodeTrace: Failed to parse AI response. Please try again.'
                );
            } else {
                vscode.window.showErrorMessage(
                    'CodeTrace: Failed to generate summary. Please try again.'
                );
            }
            
            console.error('CodeTrace: AI summary generation failed');
            return null;
        }
    }

    /**
     * Prepare minimal analysis data from session
     * Only includes file paths and metadata, NOT file content
     */
    private prepareAnalysisData(session: SessionForAnalysis): {
        duration: string;
        repository?: string;
        filesChanged: string[];
        fileChangeTimeline: Array<{ file: string; time: string }>;
        commits: Array<{ message: string; time: string }>;
        uniqueDirectories: string[];
    } {
        // Get unique files
        const filesChanged = [...new Set(session.changes.map(c => c.file))];
        
        // Build file change timeline
        const fileChangeTimeline = session.changes.map(c => ({
            file: c.file,
            time: new Date(c.timestamp).toLocaleTimeString()
        }));

        // Get commits with messages
        const commits = session.commits.map(c => ({
            message: c.message,
            time: new Date(c.timestamp).toLocaleTimeString()
        }));

        // Extract unique directories to understand project structure
        const uniqueDirectories = [...new Set(
            filesChanged.map(f => {
                const parts = f.split('/');
                return parts.length > 1 ? parts.slice(0, -1).join('/') : '/';
            })
        )];

        // Calculate duration
        const duration = session.stats?.duration || 'Unknown';

        return {
            duration: `${duration} minutes`,
            repository: session.repository,
            filesChanged,
            fileChangeTimeline,
            commits,
            uniqueDirectories
        };
    }

    /**
     * Build the prompt for the AI
     */
    private buildPrompt(data: {
        duration: string;
        repository?: string;
        filesChanged: string[];
        fileChangeTimeline: Array<{ file: string; time: string }>;
        commits: Array<{ message: string; time: string }>;
        uniqueDirectories: string[];
    }): string {
        let prompt = `Analyze this coding session and generate a summary.\n\n`;
        
        prompt += `**Session Duration:** ${data.duration}\n`;
        
        if (data.repository) {
            prompt += `**Repository:** ${data.repository}\n`;
        }
        
        prompt += `\n**Files Modified (${data.filesChanged.length} files):**\n`;
        for (const file of data.filesChanged.slice(0, 20)) {
            prompt += `- ${file}\n`;
        }
        if (data.filesChanged.length > 20) {
            prompt += `- ... and ${data.filesChanged.length - 20} more files\n`;
        }

        prompt += `\n**Directory Structure:**\n`;
        for (const dir of data.uniqueDirectories.slice(0, 10)) {
            prompt += `- ${dir}/\n`;
        }

        if (data.commits.length > 0) {
            prompt += `\n**Commits Made (${data.commits.length}):**\n`;
            for (const commit of data.commits) {
                prompt += `- "${commit.message}" (${commit.time})\n`;
            }
        }

        prompt += `\n**File Change Timeline (first 15 changes):**\n`;
        for (const change of data.fileChangeTimeline.slice(0, 15)) {
            prompt += `- ${change.time}: ${change.file}\n`;
        }

        prompt += `\nBased on this information, generate a JSON summary of what was accomplished in this coding session.`;

        return prompt;
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        this.openai = null;
    }
}

