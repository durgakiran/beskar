.PHONY: dev dev-native build-dev build-production build-mac build-win build-linux test-tls icons package-mac-dev
.DEFAULT_GOAL := dev

RELEASE_TEAM_ID ?=
DEV_BUNDLE := bin/Teddox Development.app

# Generated assets are checked in; regeneration requires macOS AppKit.
icons:
	@set -eu; work=$$(mktemp -d); trap 'rm -rf "$$work"' EXIT; \
	mkdir "$$work/teddox.iconset"; \
	clang -fobjc-arc -framework AppKit scripts/generate-icons.m -o "$$work/generate-icons"; \
	"$$work/generate-icons" "$$PWD/assets" "$$work/teddox.iconset"; \
	iconutil -c icns -o assets/teddox.icns "$$work/teddox.iconset"

# Build/copy the frontend to ui/dist first. Sign only after installing resources.
package-mac-dev:
	mkdir -p "$(DEV_BUNDLE)/Contents/MacOS" "$(DEV_BUNDLE)/Contents/Resources"
	go build -tags beskar_dev -o "$(DEV_BUNDLE)/Contents/MacOS/teddox" .
	cp macos/Info.development.plist "$(DEV_BUNDLE)/Contents/Info.plist"
	cp assets/teddox.icns "$(DEV_BUNDLE)/Contents/Resources/teddox.icns"
	codesign --force --deep --sign - "$(DEV_BUNDLE)"

dev:
	wails3 dev

# Run after building/copying the desktop UI. TLS still verifies by default;
# self-signed development servers additionally require BESKAR_DEV_ALLOW_SELF_SIGNED=1.
dev-native:
	go run -tags beskar_dev .

build-dev:
	go build -tags beskar_dev -o bin/teddox-dev .

build-production:
	go build -tags '' -ldflags '-X beskar/desktop/config.ReleaseTeamID=$(RELEASE_TEAM_ID)' -o bin/teddox-production .

test-tls:
	go test -tags '' ./config
	go test -tags beskar_dev ./config

build-mac:
	wails3 build -platform darwin/universal

build-win:
	wails3 build -platform windows/amd64

build-linux:
	wails3 build -platform linux/amd64
