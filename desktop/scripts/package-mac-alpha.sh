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
[[ ! -e "$OUTPUT_DIR" ]] || fail 'version/architecture output already exists; choose a new version or move the old output'
if [[ "$CHECK_ONLY" == true ]]; then
    echo "Alpha configuration valid: $ALPHA_VERSION / $ALPHA_ARCH"
    echo "API: $ALPHA_API_ORIGIN; issuer: $ALPHA_ISSUER_ORIGIN"
    echo "Output: $OUTPUT_DIR"
    exit 0
fi
mkdir -p "$DESKTOP_DIR/bin"
WORK_DIR="$(mktemp -d "$DESKTOP_DIR/bin/.alpha-package.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

# Require dependencies installed from lockfiles beforehand. Always build fresh
# desktop UI; never reuse the web build or the development app's cached assets.
npm --prefix "$ROOT_DIR/ui" run build:desktop -- --outDir "$WORK_DIR/ui"
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
