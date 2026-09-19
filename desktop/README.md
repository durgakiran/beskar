# Teddox Desktop Application

This is the desktop client for the application, built using [Wails v3](https://wails.io/) and React. It wraps the core UI and provides native OS integrations, deep linking, and a dedicated proxy middleware for authenticated API requests.

## Prerequisites

Before building or running the desktop application, ensure you have the following installed on your machine:

1. **Go** (1.20 or later) - [Download](https://go.dev/dl/)
2. **Node.js** (v18 or later) & **npm** - [Download](https://nodejs.org/)
3. **Wails v3 CLI** - Installed via Go:
   ```bash
   go install github.com/wailsapp/wails/v3/cmd/wails3@latest
   ```
4. **C Compiler** (gcc) and standard build tools required by Wails (e.g., Mingw-w64 on Windows, Xcode command line tools on macOS, build-essential on Linux).

## Build Configurations & Environment Variables

The desktop application is designed to be environment-agnostic. Hardcoded URLs are avoided. Instead, we inject environment-specific URLs at build-time using Go's `ldflags`.

The configuration variables exposed for injection are located in the `beskar/desktop/config` package:
- `DefaultServerURL`: The main API backend URL. (Default: `https://app.durgakiran.com`)
- `DefaultZitadelURL`: The Zitadel Authentication server URL. (Default: `https://id.durgakiran.com`)
- `DefaultClientID`: The OAuth Client ID used for authentication. (Default: `377926419071631362`)

### Example: Injecting Dev Configuration

To override the production defaults and target your development environment, pass the `-ldflags` parameter to the Wails CLI (or raw `go build` command):

```bash
wails3 build -ldflags "-X 'beskar/desktop/config.DefaultServerURL=https://dev.durgakiran.com' -X 'beskar/desktop/config.DefaultZitadelURL=https://id-dev.durgakiran.com' -X 'beskar/desktop/config.DefaultClientID=YOUR_DEV_CLIENT_ID'"
```

## Running in Development Mode

To run the application in live development mode (which enables hot-reloading for the frontend UI):

1. **Start the Frontend Dev Server**: 
   Open a terminal in the `ui` directory and run:
   ```bash
   npm run dev:desktop
   ```
2. **Start the Wails Dev Server**: 
   Open another terminal in the `desktop` directory and run:
   ```bash
   wails3 dev -config ./build/config.yml -port 9245
   ```
   *Note: You can also pass `-ldflags` to `wails3 dev` if you need to target a staging backend during development.*

## Building and Packaging for Production

To package the application into a standalone executable (e.g., `.exe` for Windows, `.app` for macOS):

1. Make sure your UI frontend dependencies are installed and the editor package is properly built.
2. Run the Wails build command in the `desktop` directory, passing your production (or staging) `-ldflags`:

```bash
wails3 build -ldflags "-X 'beskar/desktop/config.DefaultServerURL=https://app.durgakiran.com' -X 'beskar/desktop/config.DefaultZitadelURL=https://id.durgakiran.com' -X 'beskar/desktop/config.DefaultClientID=377926419071631362'"
```

### Build Outputs
The compiled binaries and installers will be generated inside the `desktop/bin/` directory.

> **Note on Cross-Compilation:** Wails relies on CGO to bind to native OS webviews. Therefore, to build a Windows `.exe`, you must build on Windows. To build a macOS `.app`, you must build on a Mac. Cross-compilation is generally not supported out-of-the-box without specialized docker containers (like xgo).
