.PHONY: dev dev-native build-dev build-production build-mac build-win build-linux test-tls

RELEASE_TEAM_ID ?=

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
