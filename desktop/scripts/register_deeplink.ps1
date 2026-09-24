# register_deeplink.ps1
# Registers the "teddox://" protocol handler in the Windows Registry for local development.

$ProtocolName = "teddox"
$ProtocolDescription = "Teddox Deep Link Protocol"
# We resolve the path to the current directory assuming the script is in beskar/desktop/scripts,
# but we need to point to the built executable or 'wails3 dev'.
# Since Wails dev server rebuilds to a temp dir, it's tricky to deep-link to 'wails dev'.
# Usually, deep linking is tested against the compiled binary.
$AppPath = Resolve-Path "..\bin\Teddox.exe" -ErrorAction SilentlyContinue

if (-not $AppPath) {
    Write-Host "Teddox.exe not found in desktop\bin. Please run 'go build -o bin/Teddox.exe .' first." -ForegroundColor Red
    exit 1
}

$CommandString = "`"$AppPath`" `"%1`""

Write-Host "Registering protocol '${ProtocolName}://' to run '$CommandString'"

New-Item -Path "HKCU:\Software\Classes\$ProtocolName" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\$ProtocolName" -Name "(Default)" -Value $ProtocolDescription
Set-ItemProperty -Path "HKCU:\Software\Classes\$ProtocolName" -Name "URL Protocol" -Value ""

New-Item -Path "HKCU:\Software\Classes\$ProtocolName\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\$ProtocolName\shell\open\command" -Name "(Default)" -Value $CommandString

Write-Host "Successfully registered ${ProtocolName}:// deep links for the current user!" -ForegroundColor Green
