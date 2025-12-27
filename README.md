# 🎬 CodeTrace

> **Smart Coding Session Recorder for VS Code**

CodeTrace automatically records your coding sessions, tracks file changes and git commits, and generates AI-powered summaries to help you understand your coding patterns.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

### 📹 Session Recording
- **One-click recording** - Start/stop with a keyboard shortcut or status bar click
- **File change tracking** - Captures every save with full content snapshots
- **Git integration** - Automatically tracks commits made during sessions
- **Ignore patterns** - Skip node_modules, build folders, etc.

### 📊 Timeline Visualization
- **Interactive timeline** - See your activity visualized as an SVG timeline
- **File type colors** - Different colors for .ts, .js, .css, etc.
- **Click to inspect** - View file content at any point in time

### 🤖 AI-Powered Summaries
- **Automatic insights** - Generate summaries using GPT-4
- **Understand your work** - See what was built, key files, and apparent goals
- **Session titles** - AI-suggested names for your sessions

### 📄 Export & Reports
- **Markdown export** - Generate beautiful reports from any session
- **Session management** - Delete old sessions, auto-cleanup

## 🚀 Quick Start

### Installation

1. Install from VS Code Marketplace (coming soon)
2. Or clone and install locally:
   ```bash
   git clone https://github.com/faoziaabedin/CodeTrace.git
   cd CodeTrace
   npm install
   npm run compile
   ```

### Basic Usage

1. **Start Recording**: Press `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
2. **Code normally** - All file saves and git commits are tracked
3. **Stop Recording**: Press `Cmd+Shift+R` again
4. **View Timeline**: Press `Cmd+Shift+T` to open the session timeline

## ⌨️ Keyboard Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Start/Stop Recording | `Cmd+Shift+R` | `Ctrl+Shift+R` |
| Open Timeline | `Cmd+Shift+T` | `Ctrl+Shift+T` |

## 🎮 Commands

Open the Command Palette (`Cmd+Shift+P`) and type "CodeTrace":

| Command | Description |
|---------|-------------|
| `CodeTrace: Start Recording` | Begin recording session |
| `CodeTrace: Stop Recording` | Stop and save session |
| `CodeTrace: Open Session Timeline` | View all recorded sessions |
| `CodeTrace: View Session Stats` | Quick stats for current/last session |
| `CodeTrace: Generate AI Summary` | Create AI summary for a session |
| `CodeTrace: Export as Markdown` | Export session as markdown report |
| `CodeTrace: Delete Session` | Remove a session (with confirmation) |
| `CodeTrace: Open Settings` | Configure CodeTrace settings |

## ⚙️ Configuration

Access settings via `Cmd+,` and search for "CodeTrace":

### General Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codetrace.autoRecordOnStart` | `false` | Auto-start recording when VS Code opens |
| `codetrace.showNotifications` | `true` | Show notification messages |
| `codetrace.maxSessionsToKeep` | `50` | Max sessions before auto-cleanup |

### File Patterns

| Setting | Default | Description |
|---------|---------|-------------|
| `codetrace.ignorePatterns` | `["node_modules/**", ".git/**", ...]` | Files to ignore |

### AI Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codetrace.openaiApiKey` | `""` | Your OpenAI API key |
| `codetrace.aiModel` | `gpt-4o-mini` | Model for summaries |
| `codetrace.autoGenerateSummary` | `false` | Auto-generate on stop |

## 🔑 OpenAI Setup

To use AI features:

1. Get an API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Open VS Code Settings (`Cmd+,`)
3. Search for "codetrace.openaiApiKey"
4. Paste your API key

> **Note**: Your API key is stored securely in VS Code's encrypted settings and is never logged or transmitted except to OpenAI.

## 📁 Data Storage

Sessions are stored in `.codetrace/` folder in your workspace:

```
.codetrace/
├── session-2024-12-27T14-30-00-000Z.json
├── session-2024-12-27T16-45-00-000Z.json
└── ...
```

### Session JSON Structure

```json
{
  "sessionId": "uuid",
  "startTime": "2024-12-27T14:30:00.000Z",
  "endTime": "2024-12-27T15:30:00.000Z",
  "repository": "my-project",
  "changes": [
    {
      "file": "src/index.ts",
      "timestamp": "2024-12-27T14:35:00.000Z",
      "content": "// file content..."
    }
  ],
  "commits": [
    {
      "hash": "abc123",
      "message": "feat: add feature",
      "author": "Your Name",
      "timestamp": "2024-12-27T15:00:00.000Z"
    }
  ],
  "stats": {
    "filesChanged": 5,
    "commitsCount": 2,
    "duration": "60"
  },
  "summary": {
    "whatWasBuilt": "Added new feature...",
    "keyFilesModified": ["index.ts", "styles.css"],
    "apparentGoal": "Implement X feature",
    "suggestedTitle": "Feature Development"
  }
}
```

## 🧪 Development

### Setup

```bash
git clone https://github.com/faoziaabedin/CodeTrace.git
cd CodeTrace
npm install
```

### Build

```bash
npm run compile    # One-time build
npm run watch      # Watch mode
```

### Test

```bash
# Press F5 in VS Code to launch Extension Development Host
npm run test       # Run unit tests
```

### Package

```bash
npm run package    # Creates .vsix file
```

## 🏗️ Architecture

```
src/
├── extension.ts           # Main extension entry point
├── AIService.ts           # OpenAI integration
├── SessionTimelinePanel.ts # Webview panel manager
└── webview/
    ├── index.html         # Timeline HTML
    ├── styles.css         # Theme-aware styles
    └── script.js          # Timeline interactivity
```

### Key Components

- **RecordingManager**: Handles session lifecycle, file watching
- **GitTracker**: Monitors git commits using simple-git
- **AIService**: Generates summaries via OpenAI API
- **SessionTimelinePanel**: Renders the webview UI

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📝 Changelog

### v1.0.0 (2024-12-27)
- Initial release
- Session recording with file and git tracking
- AI-powered summaries
- Timeline visualization
- Markdown export

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [simple-git](https://github.com/steveukx/git-js) - Git operations
- [OpenAI](https://openai.com/) - AI summaries
- VS Code Extension API

---

**Made with ❤️ by [Faozia Abedin](https://github.com/faoziaabedin)**
