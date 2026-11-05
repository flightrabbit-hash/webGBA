# 시험 exe 본 창 최소화·복원(app-log.mjs). 마우스를 움직이지 않는다.
#   powershell -NoProfile -ExecutionPolicy Bypass -File window-show.ps1 <프로세스 번호> minimize|restore
param([int]$ProcessId, [string]$Action)
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class WinPick {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static IntPtr Find(uint want) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      if (pid == want && IsWindowVisible(h) && c.ToString().Contains("Tauri")) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$ErrorActionPreference = "Stop"
$h = [WinPick]::Find([uint32]$ProcessId)
if (-not $h -or $h -eq [IntPtr]::Zero) { Write-Output "no-window"; exit 1 }
if ($Action -eq "minimize") { [WinPick]::ShowWindow($h, 6) | Out-Null } else { [WinPick]::ShowWindow($h, 9) | Out-Null; [WinPick]::SetForegroundWindow($h) | Out-Null }
Write-Output "ok $Action"
