/**
 * AIService - OpenAI Integration for CodeTrace
 * 
 * This handles all the AI stuff - generating summaries using OpenAI's API.
 * I chose to use their official SDK because it handles all the edge cases
 * like rate limiting, retries, and proper error handling.
 * 
 * Security notes:
 * - API key is stored in VS Code settings (which encrypts sensitive data)
 * - I never log the API key anywhere
 * - Only file paths are sent to the API, never actual code content
 *   (that would be too expensive and potentially leak private code)
 * 
 * @author Faozia Abedin
 */

import * as vscode from 'vscode';
import OpenAI from 'openai';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * The structure for AI-generated summaries
 * I designed this to be useful at a glance while still having enough detail
 */
export interface SessionSummary {
    whatWasBuilt: string;         // High-level description
    keyFilesModified: string[];   // Most important files
    apparentGoal: string;         // What I think the user was trying to accomplish
    suggestedTitle: string;       // Short title for the session
    generatedAt: string;          // ISO timestamp
    model: string;                // Which model generated this
}

/**
 * Simplified session data for AI analysis
 * I strip out the content because it's too large and expensive to send
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
     * Sets up the OpenAI client with the user's API key
     * Returns false if the key isn't configured
     */
    private async initializeClient(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('codetrace');
        const apiKey = config.get<string>('openaiApiKey');

        // No API key? Show a helpful message with a button to open settings
        if (!apiKey || apiKey.trim() === '') {
            const action = await vscode.window.showErrorMessage(
                'OpenAI API key not set. Add it in settings to use AI features.',
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
            // Create the client - the SDK handles all the HTTP stuff
            this.openai = new OpenAI({ apiKey });
            return true;
        } catch (error) {
            console.error('CodeTrace: Failed to initialize OpenAI client');
            vscode.window.showErrorMessage('Failed to connect to OpenAI. Check your API key.');
            return false;
        }
    }

    /**
     * Gets the model setting - defaulting to gpt-4o-mini because it's
     * fast and cheap but still pretty good at understanding code context
     */
    private getModel(): string {
        const config = vscode.workspace.getConfiguration('codetrace');
        return config.get<string>('aiModel') || 'gpt-4o-mini';
    }

    /**
     * Main method - generates a summary for a coding session
     * 
     * The approach is:
     * 1. Extract just the metadata (no file contents - too expensive)
     * 2. Build a prompt that gives the AI good context
     * 3. Ask for JSON output so we can parse it easily
     * 4. Handle all the various errors that can happen with APIs
     */
    public async generateSessionSummary(
        session: SessionForAnalysis
    ): Promise<SessionSummary | null> {
        const initialized = await this.initializeClient();
        if (!initialized || !this.openai) {
            return null;
        }

        // Build the data to send (minimal, no content)
        const analysisData = this.prepareAnalysisData(session);
        const prompt = this.buildPrompt(analysisData);

        try {
            const model = this.getModel();
            
            // Make the API call
            // I'm using JSON mode so the response is always valid JSON
            const response = await this.openai.chat.completions.create({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: `You're a helpful assistant that analyzes coding sessions. 
                        
Given information about files changed and commits made, generate a concise summary.

Always respond with valid JSON:
{
    "whatWasBuilt": "1-2 sentence description",
    "keyFilesModified": ["file1.ts", "file2.ts"],
    "apparentGoal": "What the developer was likely trying to accomplish",
    "suggestedTitle": "Short title, 5 words max"
}

Be concise but insightful. Focus on the big picture.`
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,  // Some creativity but not too wild
                max_tokens: 500,   // Summaries should be short
                response_format: { type: 'json_object' }
            });

            // Parse the response
            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('Empty response from AI');
            }

            const parsed = JSON.parse(content);

            // Build the summary object
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
            // Handle different types of errors with helpful messages
            this.handleError(error);
            return null;
        }
    }

    /**
     * Handles API errors with user-friendly messages
     */
    private handleError(error: unknown): void {
        if (error instanceof OpenAI.APIError) {
            switch (error.status) {
                case 401:
                    vscode.window.showErrorMessage('Invalid API key. Please check your settings.');
                    break;
                case 429:
                    vscode.window.showErrorMessage('Rate limit exceeded. Try again in a minute.');
                    break;
                case 500:
                case 503:
                    vscode.window.showErrorMessage('OpenAI is having issues. Try again later.');
                    break;
                default:
                    vscode.window.showErrorMessage(`OpenAI error: ${error.message}`);
            }
        } else if (error instanceof SyntaxError) {
            vscode.window.showErrorMessage('Failed to parse AI response. Try again.');
        } else {
            vscode.window.showErrorMessage('Failed to generate summary. Check the console for details.');
        }
        
        console.error('CodeTrace: AI error:', error);
    }

    /**
     * Prepares minimal data for the AI
     * I'm careful to only include paths, not actual file content
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
        
        // Build a timeline of changes
        const fileChangeTimeline = session.changes.map(c => ({
            file: c.file,
            time: new Date(c.timestamp).toLocaleTimeString()
        }));

        // Get commit info (messages are useful context)
        const commits = session.commits.map(c => ({
            message: c.message,
            time: new Date(c.timestamp).toLocaleTimeString()
        }));

        // Figure out which directories were touched
        // This helps the AI understand the project structure
        const uniqueDirectories = [...new Set(
            filesChanged.map(f => {
                const parts = f.split('/');
                return parts.length > 1 ? parts.slice(0, -1).join('/') : '/';
            })
        )];

        return {
            duration: `${session.stats?.duration || 'Unknown'} minutes`,
            repository: session.repository,
            filesChanged,
            fileChangeTimeline,
            commits,
            uniqueDirectories
        };
    }

    /**
     * Builds a prompt that gives the AI good context
     * I found that being specific about what info is available helps a lot
     */
    private buildPrompt(data: {
        duration: string;
        repository?: string;
        filesChanged: string[];
        fileChangeTimeline: Array<{ file: string; time: string }>;
        commits: Array<{ message: string; time: string }>;
        uniqueDirectories: string[];
    }): string {
        let prompt = `Analyze this coding session:\n\n`;
        
        prompt += `**Duration:** ${data.duration}\n`;
        
        if (data.repository) {
            prompt += `**Repository:** ${data.repository}\n`;
        }
        
        // List the files (limited to 20 to avoid token limits)
        prompt += `\n**Files Modified (${data.filesChanged.length}):**\n`;
        for (const file of data.filesChanged.slice(0, 20)) {
            prompt += `- ${file}\n`;
        }
        if (data.filesChanged.length > 20) {
            prompt += `- ...and ${data.filesChanged.length - 20} more\n`;
        }

        // Directory structure gives context about project organization
        prompt += `\n**Directories:**\n`;
        for (const dir of data.uniqueDirectories.slice(0, 10)) {
            prompt += `- ${dir}/\n`;
        }

        // Commit messages are super valuable - they often explain intent
        if (data.commits.length > 0) {
            prompt += `\n**Commits (${data.commits.length}):**\n`;
            for (const commit of data.commits) {
                prompt += `- "${commit.message}" (${commit.time})\n`;
            }
        }

        // Show the order things happened in
        prompt += `\n**Activity Timeline:**\n`;
        for (const change of data.fileChangeTimeline.slice(0, 15)) {
            prompt += `- ${change.time}: ${change.file}\n`;
        }

        prompt += `\nGenerate a JSON summary of this session.`;

        return prompt;
    }

    /**
     * Cleanup
     */
    public dispose(): void {
        this.openai = null;
    }
}
