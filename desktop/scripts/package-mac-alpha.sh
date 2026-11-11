#!/usr/bin/env bash
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(dirname "$DESKTOP_DIR")"
fail() { echo "Alpha packaging: $*" >&2; exit 1; }
usage() {
    echo 'Usage: bash desktop/scripts/package-mac-alpha.sh [--env PATH] [--check]'
    echo 'Use desktop/alpha.env.example as the public build configuration template.'
    echo '--check validates inputs without building or changing generated assets.'
}
ENV_FILE=
CHECK_ONLY=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --env)
            [[ $# -ge 2 && -n "$2" && -z "$ENV_FILE" ]] || fail '--env requires one file path'
            ENV_FILE="$2"; shift 2 ;;
        --check) CHECK_ONLY=true; shift ;;
        --help|-h) usage; exit 0 ;;
        *) fail 'unknown argument; use --help' ;;
    esac
done
if [[ -n "$ENV_FILE" ]]; then
    [[ -f "$ENV_FILE" ]] || fail 'env file not found'
    # Parse literal public values only. Never source a file or execute its text.
    # Explicit file values override inherited environment values.
    SEEN_KEYS=,
    LINE_NUMBER=0
    while IFS= read -r line || [[ -n "$line" ]]; do
        LINE_NUMBER=$((LINE_NUMBER + 1))
        line="${line%$'\r'}"
        [[ "$line" =~ ^[[:space:]]*(#.*)?$ ]] && continue
        [[ "$line" == *=* ]] || fail "invalid env assignment at line $LINE_NUMBER"
        key="${line%%=*}"; value="${line#*=}"
        case "$key" in
            ALPHA_VERSION|ALPHA_BUILD|ALPHA_ARCH|ALPHA_API_ORIGIN|ALPHA_ISSUER_ORIGIN|ALPHA_CLIENT_ID) ;;
            *) fail "unsupported env key at line $LINE_NUMBER; use only the alpha template" ;;
        esac
        [[ "$SEEN_KEYS" != *",$key,"* ]] || fail "duplicate env key at line $LINE_NUMBER"
        SEEN_KEYS="$SEEN_KEYS$key,"
        # Optional matching quotes are literal wrappers, not shell syntax.
        if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then
            value="${value:1:${#value}-2}"
        fi
        printf -v "$key" '%s' "$value"
    done < "$ENV_FILE"
fi
cd "$DESKTOP_DIR"
[[ "$(uname -s)" == Darwin ]] || fail 'requires a Mac with Xcode command-line tools'
for tool in go npm codesign hdiutil ditto shasum; do
    command -v "$tool" >/dev/null || fail "missing $tool"
done
[[ "${ALPHA_VERSION:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+-alpha\.[0-9]+$ ]] || fail 'set ALPHA_VERSION, e.g. 0.1.0-alpha.1'
[[ "${ALPHA_BUILD:-}" =~ ^[1-9][0-9]*$ ]] || fail 'set ALPHA_BUILD to a positive, increasing integer'
ALPHA_ARCH="${ALPHA_ARCH:-$(go env GOHOSTARCH)}"
[[ "$ALPHA_ARCH" == arm64 || "$ALPHA_ARCH" == amd64 ]] || fail 'architecture must be arm64 or amd64'
[[ "$ALPHA_ARCH" == "$(go env GOHOSTARCH)" ]] || fail 'build on a matching architecture Mac for native dependency validation'
ALPHA_API_ORIGIN="${ALPHA_API_ORIGIN:-https://app.teddox.com}"
ALPHA_ISSUER_ORIGIN="${ALPHA_ISSUER_ORIGIN:-https://id.teddox.com}"
ALPHA_CLIENT_ID="${ALPHA_CLIENT_ID:-}"
[[ -n "$ALPHA_CLIENT_ID" ]] || fail 'set ALPHA_CLIENT_ID to the production Zitadel native public-client ID (not the browser client)'
# Restrict linker inputs to HTTPS DNS origins and a single opaque client ID.
for origin in "$ALPHA_API_ORIGIN" "$ALPHA_ISSUER_ORIGIN"; do
    [[ "$origin" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || fail 'API/issuer must be HTTPS DNS origins without paths'
done
[[ "$ALPHA_CLIENT_ID" =~ ^[a-zA-Z0-9_-]+$ ]] || fail 'invalid client ID'
[[ -z "${GOFLAGS:-}" ]] || fail 'unset GOFLAGS; release tags are controlled by this script'

OUTPUT_DIR="$DESKTOP_DIR/bin/alpha/$ALPHA_VERSION/$ALPHA_ARCH"
if [[ "$CHECK_ONLY" == true ]]; then
    echo "Alpha configuration valid: $ALPHA_VERSION / $ALPHA_ARCH"
    echo "API: $ALPHA_API_ORIGIN; issuer: $ALPHA_ISSUER_ORIGIN"
    echo "Output: $OUTPUT_DIR"
    if [[ -e "$OUTPUT_DIR" ]]; then
        echo 'Output already exists. Choose a new version or move the old output before rebuilding.'
    fi
    exit 0
fi
[[ ! -e "$OUTPUT_DIR" ]] || fail 'version/architecture output already exists; choose a new version or move the old output'
command -v node >/dev/null || fail 'missing Node.js 22'
NODE_VERSION="$(node --version)"
[[ "$NODE_VERSION" == v22.* ]] || fail "Node.js 22 is required to match the UI deployment (found $NODE_VERSION). Activate Node 22 and retry."
[[ -n "${NPM_TOKEN:-}" ]] || fail 'export NPM_TOKEN with read access to the private GitHub packages'
command -v rsync >/dev/null || fail 'missing rsync'
mkdir -p "$DESKTOP_DIR/bin"
WORK_DIR="$(mktemp -d "$DESKTOP_DIR/bin/.alpha-package.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

# Match the deployment's registry build in an isolated tree. The desktop npm
# hook builds the editor PDF entry from source, and Vite gets the main editor
# from the lockfile because no prebuilt workspace editor output is present.
UI_SOURCE="$WORK_DIR/frontend/ui"
EDITOR_SOURCE="$WORK_DIR/frontend/packages/editor"
mkdir -p "$UI_SOURCE" "$EDITOR_SOURCE" "$UI_SOURCE/public"
rsync -a --exclude=node_modules --exclude=dist --exclude=.npmrc --exclude='.env*' \
    --exclude='*.tsbuildinfo' --exclude='/public/workers' --exclude='/public/jbi.wasm' \
    "$ROOT_DIR/ui/" "$UI_SOURCE/"
cp "$ROOT_DIR/packages/editor/"{package.json,package-lock.json,tsconfig.json,tsup.pdf.config.ts} "$EDITOR_SOURCE/"
rsync -a "$ROOT_DIR/packages/editor/src/" "$EDITOR_SOURCE/src/"

# npm expands the token from the environment. The temporary config contains
# only the reference and lives outside the frontend output directory.
cat > "$WORK_DIR/npmrc" <<'EOF'
registry=https://registry.npmjs.org/
@durgakiran:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
EOF
NPM_CONFIG_USERCONFIG="$WORK_DIR/npmrc" npm --prefix "$EDITOR_SOURCE" ci --ignore-scripts --include=dev
NPM_CONFIG_USERCONFIG="$WORK_DIR/npmrc" npm --prefix "$UI_SOURCE" ci --include=dev

(cd "$ROOT_DIR/jbi" && GOWORK=off GOOS=js GOARCH=wasm go build -o "$UI_SOURCE/public/jbi.wasm" .)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$UI_SOURCE/workers/wasm_exec.js"
npm --prefix "$UI_SOURCE" run build:workers
npm --prefix "$UI_SOURCE" run build:desktop -- --outDir "$WORK_DIR/ui"
[[ -f "$WORK_DIR/ui/index.desktop.html" ]] || fail 'desktop frontend entry point is missing'
# The pinned Wails asset server discovers its filesystem root via index.html,
# even when the window explicitly opens index.desktop.html. Both must be the
# desktop entry; never borrow the web app's index.html.
cp "$WORK_DIR/ui/index.desktop.html" "$WORK_DIR/ui/index.html"
# Only this generated embed directory is replaced. Source assets are untouched.
rm -rf "$DESKTOP_DIR/ui/dist"
mkdir -p "$DESKTOP_DIR/ui/dist"
ditto "$WORK_DIR/ui" "$DESKTOP_DIR/ui/dist"

APP="$WORK_DIR/image/Teddox Alpha.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp macos/Info.alpha.plist "$APP/Contents/Info.plist"
PLIST=/usr/libexec/PlistBuddy
"$PLIST" -c "Set :CFBundleShortVersionString ${ALPHA_VERSION%%-alpha.*}" "$APP/Contents/Info.plist"
"$PLIST" -c "Set :CFBundleVersion $ALPHA_BUILD" "$APP/Contents/Info.plist"
"$PLIST" -c "Add :TeddoxReleaseVersion string $ALPHA_VERSION" "$APP/Contents/Info.plist"
cp assets/teddox.icns "$APP/Contents/Resources/teddox.icns"
GOFLAGS= GOWORK=off CGO_ENABLED=1 GOOS=darwin GOARCH="$ALPHA_ARCH" MACOSX_DEPLOYMENT_TARGET=15.0 \
    go build -trimpath -tags beskar_alpha \
    -ldflags "-X beskar/desktop/config.DefaultServerURL=$ALPHA_API_ORIGIN -X beskar/desktop/config.DefaultZitadelURL=$ALPHA_ISSUER_ORIGIN -X beskar/desktop/config.DefaultClientID=$ALPHA_CLIENT_ID" \
    -o "$APP/Contents/MacOS/teddox" .
codesign --force --sign - --identifier com.durgakiran.beskar.alpha "$APP"
codesign --verify --deep --strict "$APP"
ln -s /Applications "$WORK_DIR/image/Applications"
ARTIFACT="Teddox-$ALPHA_VERSION-macos-$ALPHA_ARCH.dmg"
hdiutil create -volname "Teddox Alpha $ALPHA_VERSION" -srcfolder "$WORK_DIR/image" \
    -format UDZO -ov "$WORK_DIR/$ARTIFACT"
hdiutil verify "$WORK_DIR/$ARTIFACT"
(cd "$WORK_DIR" && shasum -a 256 "$ARTIFACT" > SHA256SUMS)
REVISION="$(git -C "$ROOT_DIR" rev-parse HEAD)"
SOURCE_STATE=clean
[[ -z "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=normal)" ]] || SOURCE_STATE=dirty
cat > "$WORK_DIR/build-info.txt" <<EOF
version=$ALPHA_VERSION
build=$ALPHA_BUILD
architecture=$ALPHA_ARCH
node_version=$NODE_VERSION
minimum_macos=15.0
source_revision=$REVISION
source_state=$SOURCE_STATE
signing=ad-hoc
notarized=false
api_origin=$ALPHA_API_ORIGIN
issuer_origin=$ALPHA_ISSUER_ORIGIN
client_id=$ALPHA_CLIENT_ID
EOF
mkdir -p "$OUTPUT_DIR"
mv "$WORK_DIR/$ARTIFACT" "$WORK_DIR/SHA256SUMS" "$WORK_DIR/build-info.txt" "$OUTPUT_DIR/"
echo "Alpha package ready: $OUTPUT_DIR/$ARTIFACT (ad-hoc signed; not notarized)"
echo 'Verify clean-Mac installation, callback and Keychain behavior before distributing.'
