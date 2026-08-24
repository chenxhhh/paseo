$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Paseo Desktop Dev - Source Mode (turn-recovery)" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Home   : $env:USERPROFILE\.paseo" -ForegroundColor Gray
Write-Host "  Daemon : 127.0.0.1:6767" -ForegroundColor Gray
Write-Host "  Metro  : http://localhost:8081" -ForegroundColor Gray
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# Repo root is the parent of scripts/ (this polyfill lives there). Deriving it
# from $PSScriptRoot keeps this script portable across clone locations instead
# of hard-coding an absolute path.
$PaseoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SupervisorEntry = Join-Path $PaseoRoot "packages\server\dist\scripts\supervisor-entrypoint.js"

function Get-CommandLine([int]$ProcessId) {
    try {
        return (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop).CommandLine
    } catch {
        return $null
    }
}

function Test-PaseoRepoProcess([int]$ProcessId) {
    $commandLine = Get-CommandLine $ProcessId
    if (-not $commandLine) {
        return $false
    }
    return $commandLine.Contains($PaseoRoot)
}

function Stop-PaseoRepoDevProcesses {
    $targets = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains($PaseoRoot) -and (
            $_.CommandLine.Contains("supervisor-entrypoint.js") -or
            $_.CommandLine.Contains("\packages\desktop") -or
            $_.Name -eq "electron.exe"
        )
    }
    foreach ($target in $targets) {
        Write-Host "Stopping stale Paseo process $($target.ProcessId) ($($target.Name))..." -ForegroundColor Yellow
        Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Get-NewestSourceWriteTime([string]$Root) {
    $newest = $null
    Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch '\.(?:test|spec)\.(?:[cm]?[jt]sx?)$' } |
        ForEach-Object {
            if (-not $newest -or $_.LastWriteTime -gt $newest) {
                $newest = $_.LastWriteTime
            }
        }
    return $newest
}

function Test-ServerDistStale {
    $serverRoot = Join-Path $PaseoRoot "packages\server"
    $stamps = @(
        (Join-Path $serverRoot "dist\scripts\supervisor-entrypoint.js"),
        (Join-Path $serverRoot "dist\server\server\exports.js")
    )
    foreach ($stamp in $stamps) {
        if (-not (Test-Path $stamp)) {
            return "missing $stamp"
        }
    }

    $oldestStamp = $stamps |
        ForEach-Object { Get-Item $_ } |
        Sort-Object LastWriteTime |
        Select-Object -First 1

    $sourceRoots = @(
        (Join-Path $serverRoot "src"),
        (Join-Path $serverRoot "scripts"),
        (Join-Path $serverRoot "package.json"),
        (Join-Path $serverRoot "tsconfig.server.json")
    )
    $newestSource = $null
    foreach ($sourceRoot in $sourceRoots) {
        if (-not (Test-Path $sourceRoot)) {
            continue
        }
        $item = Get-Item $sourceRoot
        if ($item.PSIsContainer) {
            $candidate = Get-NewestSourceWriteTime $sourceRoot
        } else {
            $candidate = $item.LastWriteTime
        }
        if ($candidate -and (-not $newestSource -or $candidate -gt $newestSource)) {
            $newestSource = $candidate
        }
    }

    if ($newestSource -and $newestSource -gt $oldestStamp.LastWriteTime) {
        return "server source is newer than $($oldestStamp.Name)"
    }
    return $null
}

# --- Step 1: ensure deps + internal workspace dists are present ------------
# Fresh clones / rebuilt node_modules have two traps that break the server
# build with "tsc is not recognized" or hundreds of "Cannot find module
# '@getpaseo/<pkg>'":
#   (a) root node_modules missing  -> no .bin\tsc at all
#   (b) internal workspace packages (protocol/client/highlight/plugin/relay)
#       have no dist/ -> server tsc can't resolve their type declarations.
# Startup must not assume these were built before; verify and build if needed.
Write-Host "[1/4] Ensuring deps + internal packages are ready..." -ForegroundColor Yellow
Push-Location $PaseoRoot
try {
    $ProcExit = $null
    # (a) missing node_modules
    if (-not (Test-Path (Join-Path $PaseoRoot "node_modules\.bin\tsc"))) {
        Write-Host "  node_modules missing/incomplete -> running npm install..." -ForegroundColor Yellow
        & npm install --registry=https://mirrors.tencent.com/npm
        $ProcExit = $LASTEXITCODE
        if ($ProcExit -ne 0) {
            Write-Host "  npm install failed (exit $ProcExit). Aborting." -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "  node_modules OK" -ForegroundColor Gray
    }

# (b) internal workspace dists
    # NOTE: protocol's dist is a flat set of submodules (messages, git-remote,
    # binary-frames/...), it has NO root index.d.ts. Use a stable real file as
    # the probe for each package to avoid false "missing" -> needless rebuild.
    $internalProbes = @(
        @{ pkg = "packages\protocol";  probe = "dist\messages.d.ts" },
        @{ pkg = "packages\client";    probe = "dist\index.d.ts" },
        @{ pkg = "packages\highlight"; probe = "dist\index.d.ts" },
        @{ pkg = "packages\plugin";    probe = "dist\index.d.ts" },
        @{ pkg = "packages\relay";     probe = "dist\index.d.ts" }
    )
    $missingInternal = @()
    foreach ($item in $internalProbes) {
        $probe = Join-Path $PaseoRoot (Join-Path $item.pkg $item.probe)
        if (-not (Test-Path $probe)) {
            $missingInternal += $item.pkg
        }
    }
    if ($missingInternal.Count -gt 0) {
        Write-Host "  missing internal dist for: $($missingInternal -join ', ')" -ForegroundColor Yellow
        Write-Host "  rebuilding server deps (@getpaseo/protocol client highlight plugin relay)..." -ForegroundColor Yellow
        & npm run build:server-deps
        $ProcExit = $LASTEXITCODE
        if ($ProcExit -ne 0) {
            Write-Host "  build:server-deps failed (exit $ProcExit). Aborting." -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "  internal dists OK" -ForegroundColor Gray
    }
} finally {
    Pop-Location
}

# --- Step 2: rebuild server dist when source is newer ----------------------
# Desktop daemon loads packages/server/dist, not TypeScript. A stale dist is
# why provider probes (e.g. Cursor) keep failing after source fixes.
Write-Host "[2/4] Checking @getpaseo/server dist..." -ForegroundColor Yellow
$staleReason = Test-ServerDistStale
if ($staleReason) {
    Write-Host "  stale: $staleReason" -ForegroundColor Yellow
    Write-Host "  rebuilding @getpaseo/server..." -ForegroundColor Yellow
    Push-Location $PaseoRoot
    try {
        npm run build --workspace=@getpaseo/server
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Server dist check/build failed. Aborting." -ForegroundColor Red
            exit 1
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "  up to date ($SupervisorEntry)" -ForegroundColor Gray
}

# --- Step 3: free port 6767 if a packaged or stale source daemon owns it ----
# If the packaged (installed) Paseo grabbed 6767 first, the dev client would
# connect to ITS daemon. If a previous source daemon is still running, Electron
# reuses it and never loads the dist we just rebuilt.
Write-Host "[3/4] Checking port 6767..." -ForegroundColor Yellow
$portOwner = Get-NetTCPConnection -LocalPort 6767 -State Listen -ErrorAction SilentlyContinue
if ($portOwner) {
    $ownerPid = $portOwner.OwningProcess
    $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
    $isPackagedPaseo = $proc -and $proc.Path -like "*AppData\Local\Programs\Paseo*"
    $isSourceDaemon = Test-PaseoRepoProcess $ownerPid
    $dist = Get-Item $SupervisorEntry -ErrorAction SilentlyContinue
    $daemonOlderThanDist = $proc -and $dist -and ($proc.StartTime -lt $dist.LastWriteTime)

    if ($isPackagedPaseo) {
        Write-Host "Packaged Paseo owns port 6767 (PID $ownerPid). Stopping it so the dev daemon can take over..." -ForegroundColor Yellow
        Get-Process -Name "Paseo" -ErrorAction SilentlyContinue | Stop-Process -Force
    } elseif ($isSourceDaemon -and $daemonOlderThanDist) {
        Write-Host "Source daemon on 6767 (PID $ownerPid) started before the current dist. Restarting it..." -ForegroundColor Yellow
        Stop-PaseoRepoDevProcesses
    } elseif ($isSourceDaemon) {
        Write-Host "Source daemon on 6767 (PID $ownerPid) already matches current dist." -ForegroundColor Gray
    } else {
        Write-Host "WARNING: port 6767 is already in use by PID $ownerPid ($($proc.ProcessName))." -ForegroundColor Red
        Write-Host "If that is another daemon, close it first, then re-run." -ForegroundColor Yellow
        $answer = Read-Host "Continue anyway? (y/N)"
        if ($answer -notmatch '^[yY]') {
            Write-Host "Aborted." -ForegroundColor Yellow
            exit 1
        }
    }

    Start-Sleep -Seconds 2
    $still = Get-NetTCPConnection -LocalPort 6767 -State Listen -ErrorAction SilentlyContinue
    if ($still -and ($isPackagedPaseo -or ($isSourceDaemon -and $daemonOlderThanDist))) {
        Write-Host "ERROR: port 6767 is still in use after stopping the previous daemon. Aborting." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  free" -ForegroundColor Gray
}

# --- Step 4: launch desktop dev (loads real user data) ----------------------
Write-Host "[4/4] Starting Paseo Desktop (Electron + Metro + daemon)..." -ForegroundColor Yellow
Write-Host ""

# Load existing agents / projects from the production home
$env:PASEO_HOME = Join-Path $env:USERPROFILE ".paseo"
# Align daemon port with ~/.paseo/config.json (daemon.listen = 127.0.0.1:6767)
$env:PASEO_DEV_DAEMON_PORT = "6767"

Set-Location (Join-Path $PaseoRoot "packages\desktop")
& ".\scripts\dev.ps1"
