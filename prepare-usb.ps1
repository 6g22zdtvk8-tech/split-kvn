<#
.SYNOPSIS
    Prepare USB drives for VPN Manager auto-installation on Keenetic
    
.DESCRIPTION
    Copies files from usb-ready to specified drives and converts 
    line endings in shell scripts (CRLF to LF)
    
.PARAMETER Drives
    Drive letters or paths (can specify multiple)
    Examples: F, G, H or F:\, G:\
    
.EXAMPLE
    .\prepare-usb.ps1 F
    Prepares one drive F:\
    
.EXAMPLE
    .\prepare-usb.ps1 F G H
    Prepares three drives: F:\, G:\, H:\
#>

param(
    [Parameter(Mandatory=$true, Position=0, ValueFromRemainingArguments=$true)]
    [string[]]$Drives
)

$ErrorActionPreference = "Stop"

# Source path (relative to script location)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourcePath = $ScriptDir

# Check required files exist
$RequiredPaths = @(
    "etc\initrc",
    "install\aarch64-installer.tar.gz",
    "vpn-manager-installer\install-singbox.sh"
)

foreach ($path in $RequiredPaths) {
    if (-not (Test-Path (Join-Path $SourcePath $path))) {
        Write-Error "Required file not found: $path"
        Write-Error "Make sure script is in usb-ready folder"
        exit 1
    }
}

Write-Host "`n=== USB Preparation for VPN Manager ===" -ForegroundColor Cyan
Write-Host "Source: $SourcePath`n"

$successCount = 0
$failCount = 0

foreach ($drive in $Drives) {
    # Normalize path
    $drive = $drive.Trim()
    if ($drive.Length -eq 1) {
        $drive = "${drive}:\"
    }
    if (-not $drive.EndsWith("\")) {
        $drive = "$drive\"
    }
    
    Write-Host "--- Processing: $drive ---" -ForegroundColor Yellow
    
    # Check drive availability
    if (-not (Test-Path $drive)) {
        Write-Host "  X Drive not available: $drive" -ForegroundColor Red
        $failCount++
        continue
    }
    
    # Prevent system drive usage
    $systemDrive = $env:SystemDrive + "\"
    if ($drive -eq $systemDrive) {
        Write-Host "  X Cannot use system drive!" -ForegroundColor Red
        $failCount++
        continue
    }
    
    try {
        # 1. Copy files
        Write-Host "  Copying files..." -NoNewline
        
        Get-ChildItem $SourcePath -Exclude "prepare-usb.ps1" | ForEach-Object {
            $target = Join-Path $drive $_.Name
            if (Test-Path $target) {
                Remove-Item -Recurse -Force $target
            }
            Copy-Item -Recurse -Force $_.FullName $drive
        }
        Write-Host " OK" -ForegroundColor Green
        
        # 2. Check and convert CRLF to LF for shell scripts (backup mechanism)
        Write-Host "  Checking LF..." -NoNewline
        $convertedCount = 0
        $checkedFiles = @()
        
        Get-ChildItem -Path $drive -Recurse -File | Where-Object {
            $_.Extension -in @('.sh', '.cgi') -or
            $_.Name -match '^S[0-9]+' -or
            $_.Name -eq 'initrc'
        } | ForEach-Object {
            $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
            $relativePath = $_.FullName.Replace($drive, "")
            if ($content -and $content.Contains("`r`n")) {
                $content = $content -replace "`r`n", "`n"
                [System.IO.File]::WriteAllText($_.FullName, $content, (New-Object System.Text.UTF8Encoding $false))
                $checkedFiles += @{ Path = $relativePath; Status = "CONVERTED" }
                $convertedCount++
            } else {
                $checkedFiles += @{ Path = $relativePath; Status = "OK" }
            }
        }
        
        if ($convertedCount -eq 0) {
            Write-Host " OK (all LF)" -ForegroundColor Green
        } else {
            Write-Host " CONVERTED $convertedCount files" -ForegroundColor Yellow
        }
        
        # Show CRLF check details
        Write-Host "  LF check results:"
        foreach ($file in $checkedFiles) {
            $statusColor = if ($file.Status -eq "OK") { "Green" } else { "Yellow" }
            Write-Host "    [$($file.Status)] $($file.Path)" -ForegroundColor $statusColor
        }
        
        # 3. Verify result
        $etcExists = Test-Path (Join-Path $drive "etc\initrc")
        $installExists = Test-Path (Join-Path $drive "install\aarch64-installer.tar.gz")
        $vpnExists = Test-Path (Join-Path $drive "vpn-manager-installer\install-singbox.sh")
        
        if ($etcExists -and $installExists -and $vpnExists) {
            Write-Host "  V Drive ready!" -ForegroundColor Green
            $successCount++
        } else {
            Write-Host "  ! Prepared but some files missing" -ForegroundColor Yellow
            $successCount++
        }
        
    } catch {
        Write-Host " ERROR" -ForegroundColor Red
        Write-Host "  $_" -ForegroundColor Red
        $failCount++
    }
    
    Write-Host ""
}

# Summary
Write-Host "--- Summary ---" -ForegroundColor Cyan
Write-Host "Success: $successCount" -ForegroundColor Green
if ($failCount -gt 0) {
    Write-Host "Failed: $failCount" -ForegroundColor Red
}
Write-Host ""
