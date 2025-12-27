# CodeTrace

A VS Code extension that records your coding sessions and helps you understand what you worked on.

I built this because I kept forgetting what I did during long coding sessions. Now I can look back at a timeline of my changes, see which files I touched, and even get AI-generated summaries of my work.

## What it does

- **Records your coding sessions** - Tracks every file you save and every git commit you make
- **Shows a visual timeline** - See your activity laid out chronologically  
- **Generates AI summaries** - Uses OpenAI to summarize what you accomplished
- **Exports to markdown** - Create reports from your sessions

## Installation

Clone the repo and build it locally:

```bash
git clone https://github.com/faoziaabedin/CodeTrace.git
cd CodeTrace
npm install
npm run compile
```

Then press F5 in VS Code to run the extension in development mode.

## How to use it

### Recording a session

1. Press `Cmd+Shift+R` (or `Ctrl+Shift+R` on Windows) to start recording
2. Code like you normally would
3. Press the same shortcut again to stop

That's it. Your session gets saved automatically.

### Viewing your sessions

Press `Cmd+Shift+T` to open the timeline view. You'll see all your recorded sessions with:
- When you started and stopped
- How many files you changed
- Any commits you made
- AI summary (if you generated one)

Click on a session to see the detailed timeline with every file save plotted over time.

### Getting AI summaries

You need an OpenAI API key for this feature.

1. Go to VS Code settings and search for "codetrace"
2. Add your API key in the `codetrace.openaiApiKey` field
3. Run the command "CodeTrace: Generate AI Summary"
4. Pick which session you want summarized

The AI looks at your file changes and commits to figure out what you were working on.

## Commands

| Command | What it does |
|---------|--------------|
| CodeTrace: Start Recording | Begin tracking your session |
| CodeTrace: Stop Recording | Stop and save the session |
| CodeTrace: Open Session Timeline | View all your sessions |
| CodeTrace: Generate AI Summary | Get an AI summary for a session |
| CodeTrace: Export as Markdown | Save a session as a .md file |
| CodeTrace: Delete Session | Remove a session you don't need |

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+R` | Toggle recording on/off |
| `Cmd+Shift+T` | Open timeline |

## Settings

You can configure these in VS Code settings:

- `codetrace.openaiApiKey` - Your OpenAI API key (required for AI features)
- `codetrace.aiModel` - Which model to use (defaults to gpt-4o-mini)
- `codetrace.autoRecordOnStart` - Start recording when VS Code opens
- `codetrace.ignorePatterns` - Files to skip (node_modules, .git, etc.)
- `codetrace.maxSessionsToKeep` - How many sessions to keep before deleting old ones
- `codetrace.autoGenerateSummary` - Auto-generate summary when you stop recording

## Where data is stored

Sessions are saved as JSON files in a `.codetrace` folder in your workspace. Each session is a separate file with the timestamp in the name.

The files include:
- List of every file you saved (with the content at that point)
- Any git commits you made
- Timestamps for everything
- AI summary if you generated one

## Project structure

```
src/
  extension.ts           - Main extension code
  AIService.ts           - OpenAI integration
  SessionTimelinePanel.ts - The webview UI
  webview/
    index.html           - Timeline HTML
    styles.css           - Styling
    script.js            - Timeline interactivity
```

## Tech stack

- TypeScript
- VS Code Extension API
- simple-git (for tracking commits)
- OpenAI API (for summaries)

## Known limitations

- Only works with single-folder workspaces right now
- Large sessions (hundreds of file saves) might be slow to load
- Git tracking polls every 5 seconds, so there's a slight delay

## License

MIT

---

Built by [Faozia Abedin](https://github.com/faoziaabedin)
