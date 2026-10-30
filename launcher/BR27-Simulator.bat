@echo off
rem BR27 electrical simulator launcher (Windows). Double-click to run.
rem Each start it downloads the newest version from GitHub, installs Python
rem and everything else it needs the first time (into %LOCALAPPDATA%\BR27Sim),
rem then opens the simulator in your browser. Close this window to stop it.
title BR27 Electrical Simulator
set "BR27_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = [IO.File]::ReadAllText($env:BR27_SELF); iex $s.Substring($s.IndexOf('#' + 'PS-START'))"
if errorlevel 1 pause
exit /b

#PS-START
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo   = 'Tanner-Fuchs/fsae-car-electrical-simulation'
$Branch = 'main'
$Root   = Join-Path $env:LOCALAPPDATA 'BR27Sim'
$App    = Join-Path $Root 'app'
$UvDir  = Join-Path $Root 'uv'
$Uv     = Join-Path $UvDir 'uv.exe'
$VerFile = Join-Path $Root 'version.txt'
$Agent  = 'br27sim-launcher'

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

try {
    Say 'BR27 Electrical Simulator' 'Cyan'
    New-Item -ItemType Directory -Force $Root | Out-Null

    # 1. uv: a small tool that installs Python and the simulator's packages
    if (-not (Test-Path $Uv)) {
        Say 'First run: downloading the Python installer (uv)...'
        $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { 'x86_64' }
        $zip = Join-Path $Root 'uv.zip'
        Invoke-WebRequest "https://github.com/astral-sh/uv/releases/latest/download/uv-$arch-pc-windows-msvc.zip" -OutFile $zip -UserAgent $Agent -UseBasicParsing
        Expand-Archive $zip -DestinationPath $UvDir -Force
        Remove-Item $zip
    }

    # 2. newest version of the simulator from GitHub
    $current = if (Test-Path $VerFile) { (Get-Content $VerFile -Raw).Trim() } else { '' }
    $latest = $null
    try {
        $commit = Invoke-RestMethod "https://api.github.com/repos/$Repo/commits/$Branch" -UserAgent $Agent -UseBasicParsing
        $latest = $commit.sha
    } catch {
        Say 'Could not check GitHub for updates (offline?). Using the version already installed.' 'Yellow'
    }
    if ($latest -and $latest -ne $current) {
        Say ("Downloading update {0}: {1}" -f $latest.Substring(0, 7), ($commit.commit.message -split "`n")[0])
        $zip = Join-Path $Root 'app.zip'
        $tmp = Join-Path $Root 'app-new'
        if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
        Invoke-WebRequest "https://api.github.com/repos/$Repo/zipball/$latest" -OutFile $zip -UserAgent $Agent -UseBasicParsing
        Expand-Archive $zip -DestinationPath $tmp -Force
        Remove-Item $zip
        $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
        if (Test-Path $App) { Remove-Item $App -Recurse -Force }
        Move-Item $inner.FullName $App
        Remove-Item $tmp -Recurse -Force
        Set-Content $VerFile $latest
    } elseif ($latest) {
        Say ('Up to date ({0}).' -f $latest.Substring(0, 7))
    }
    if (-not (Test-Path $App)) { throw 'The simulator has not been downloaded yet. Connect to the internet and run this again.' }

    # 3. run it (uv installs Python 3.12 and the packages the first time; later starts are quick)
    $env:UV_PROJECT_ENVIRONMENT = Join-Path $Root 'venv'
    Say 'Starting the simulator. Your browser will open. Close this window to stop it.' 'Green'
    & $Uv run --project $App --python 3.12 --frozen br27sim serve
    if ($LASTEXITCODE -ne 0) { throw "The simulator stopped with an error (exit code $LASTEXITCODE)." }
} catch {
    Say ''
    Say "Something went wrong: $($_.Exception.Message)" 'Red'
    Say "If it keeps happening, delete the folder $Root and run the launcher again."
    exit 1
}
