param(
    [string]$TargetPath
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ShellNotify {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern void SHChangeNotify(uint wEventId, uint uFlags, string dwItem1, IntPtr dwItem2);
}
"@

$SHCNE_UPDATEDIR = 0x00001000
$SHCNE_UPDATEITEM = 0x00002000
$SHCNE_ASSOCCHANGED = 0x08000000
$SHCNF_PATHW = 0x0005
$SHCNF_FLUSHNOWAIT = 0x2000

try {
    if ($TargetPath) {
        $resolvedPath = (Resolve-Path -LiteralPath $TargetPath -ErrorAction Stop).ProviderPath
        [ShellNotify]::SHChangeNotify($SHCNE_UPDATEITEM, $SHCNF_PATHW -bor $SHCNF_FLUSHNOWAIT, $resolvedPath, [IntPtr]::Zero)

        $parentDir = [System.IO.Path]::GetDirectoryName($resolvedPath)
        if ($parentDir) {
            [ShellNotify]::SHChangeNotify($SHCNE_UPDATEDIR, $SHCNF_PATHW -bor $SHCNF_FLUSHNOWAIT, $parentDir, [IntPtr]::Zero)
        }
    }

    [ShellNotify]::SHChangeNotify($SHCNE_ASSOCCHANGED, 0, [IntPtr]::Zero, [IntPtr]::Zero)

    $ie4uinitPath = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
    if (Test-Path -LiteralPath $ie4uinitPath) {
        & $ie4uinitPath -ClearIconCache 2>$null | Out-Null
        Start-Sleep -Milliseconds 150
        & $ie4uinitPath -show 2>$null | Out-Null
    }
} catch {
    Write-Verbose $_
}
