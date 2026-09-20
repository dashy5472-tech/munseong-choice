# 만들어진 .hwpx 를 한글로 열어 화면을 그림으로 남긴다 (윈도우 + 한글이 깔린 컴퓨터에서만).
#
# 쪽수나 파일 구조는 hwpx-check.mjs · hwpx-open.ps1 이 재 주지만, 글자가 어디에 어떻게
# 놓였는지는 눈으로 봐야 안다. 정렬·대각선·칸 너비를 고친 뒤 이걸로 확인한다.
#
#   npm run check:hwpx        # 먼저 .hwpx-check 에 파일을 만들고
#   npm run shot:hwpx         # 한글로 열어 .hwpx-check/shot/ 에 그림으로 남긴다
#
# 창이 다른 창에 가려도 그대로 찍힌다(PrintWindow). 상태 표시줄의 [쪽 맞춤] 을 눌러
# 한 쪽이 다 보이게 한 뒤 찍는다.

param(
  [string]$Dir = ".hwpx-check",
  [string]$Out = ".hwpx-check\shot",
  [int]$WaitSeconds = 15
)

Add-Type -AssemblyName System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;using System.Runtime.InteropServices;
public class HwpWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  public struct R { public int L,T,Rt,B; }
}
"@

$candidates = @(
  "$env:ProgramFiles\Hnc\Office 2024\HOffice130\Bin\Hwp.exe",
  "${env:ProgramFiles(x86)}\Hnc\Office 2024\HOffice130\Bin\Hwp.exe"
)
$hwp = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $hwp) {
  $hwp = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Hnc", "$env:ProgramFiles\Hnc" -Filter Hwp.exe -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $hwp) { Write-Output "한글을 찾지 못했습니다. 건너뜁니다."; exit 0 }

$files = Get-ChildItem -Path $Dir -Filter *.hwpx -ErrorAction SilentlyContinue | Sort-Object Name
if (-not $files) { Write-Output "$Dir 에 .hwpx 가 없습니다. 먼저 npm run check:hwpx 를 돌리세요."; exit 1 }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

foreach ($f in $files) {
  Get-Process Hwp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 1500
  $p = Start-Process -FilePath $hwp -ArgumentList "`"$($f.FullName)`"" -PassThru
  Start-Sleep -Seconds $WaitSeconds
  $proc = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.MainWindowHandle -eq 0) { Write-Output "  실패 $($f.Name) — 창을 찾지 못했습니다"; continue }

  [HwpWin]::ShowWindow($proc.MainWindowHandle, 3) | Out-Null   # 최대화
  Start-Sleep -Seconds 2

  # 상태 표시줄의 [쪽 맞춤] 을 눌러 한 쪽이 다 보이게 한다
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
  foreach ($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
    foreach ($e in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
      if ($e.Current.Name -eq '쪽 맞춤') {
        try { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch {}
      }
    }
  }
  Start-Sleep -Seconds 3

  $r = New-Object HwpWin+R
  [HwpWin]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null
  $bmp = New-Object System.Drawing.Bitmap ($r.Rt - $r.L), ($r.B - $r.T)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [HwpWin]::PrintWindow($proc.MainWindowHandle, $hdc, 2) | Out-Null   # 2 = 가려져도 전체 내용
  $g.ReleaseHdc($hdc)
  $path = Join-Path $Out ($f.BaseName + ".png")
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "  $path"
}
Get-Process Hwp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output "`n$Out 에 남겼습니다"
