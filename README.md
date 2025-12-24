# CodeTrace

A VS Code extension that records coding sessions and uses AI to analyze them.

## Features

- **Start/Stop Recording**: Track your coding sessions with simple commands
- **File Change Tracking**: Automatically records file creations, modifications, and deletions
- **Status Bar Indicator**: Visual feedback showing current recording state
- **Session Storage**: Records are saved locally in JSON format

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [VS Code](https://code.visualstudio.com/) (v1.85.0 or higher)
- npm (comes with Node.js)

### Installation & Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd CodeTrace
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Compile the TypeScript**
   ```bash
   npm run compile
   ```

4. **Run the extension in development mode**
   - Open this folder in VS Code
   - Press `F5` to launch the Extension Development Host
   - A new VS Code window will open with the extension loaded

### Project Structure

```
CodeTrace/
├── src/                    # Source files
│   └── extension.ts        # Main extension entry point
├── tests/                  # Test files
├── out/                    # Compiled JavaScript (generated)
├── .vscode/               
│   └── launch.json         # Debug configuration
├── package.json            # Extension manifest
├── tsconfig.json           # TypeScript configuration
├── .gitignore             
└── README.md              
```

## Usage

### Commands

Open the Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux):

| Command | Description |
|---------|-------------|
| `CodeTrace: Start Recording` | Begin recording your coding session |
| `CodeTrace: Stop Recording` | Stop recording and save the session |

### Status Bar

The extension adds a status bar item on the left side:

- **🔴 CodeTrace: Recording** - Currently recording (click to stop)
- **⭕ CodeTrace: Stopped** - Not recording (click to start)

## Development

### Available Scripts

```bash
# Compile TypeScript to JavaScript
npm run compile

# Watch for changes and recompile automatically
npm run watch

# Run linting
npm run lint

# Run tests
npm run test
```

### Debugging

1. Open VS Code in the project folder
2. Go to Run and Debug (`Cmd+Shift+D` / `Ctrl+Shift+D`)
3. Select "Run Extension" from the dropdown
4. Press `F5` to start debugging

This will open a new VS Code window (Extension Development Host) with your extension loaded. You can set breakpoints in your TypeScript code and debug normally.

### Making Changes

1. Edit files in the `src/` folder
2. If watching (`npm run watch`), changes compile automatically
3. Press `Cmd+R` / `Ctrl+R` in the Extension Development Host to reload

## Architecture

### Core Components

- **RecordingManager**: Central class managing recording state
  - Handles start/stop logic
  - Manages file watchers
  - Updates status bar
  
- **FileSystemWatcher**: VS Code API for tracking file changes
  - Watches for file creation, modification, deletion
  
- **Data Models**:
  - `RecordingSession`: Represents a complete recording session
  - `FileChangeEvent`: Represents a single file change

### Data Flow

```
User Action → Command → RecordingManager → FileWatcher → Session Data
                              ↓
                         Status Bar Update
```

## Roadmap

- [x] Phase 1: Basic recording functionality
- [ ] Phase 2: Session storage and retrieval
- [ ] Phase 3: AI analysis integration
- [ ] Phase 4: UI panel for viewing sessions

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

