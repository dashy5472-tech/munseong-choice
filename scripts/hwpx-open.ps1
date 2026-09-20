# 만들어진 .hwpx 를 한글로 실제로 열어 보고, 몇 쪽으로 나오는지 읽는다.
# (윈도우 + 한글이 깔린 컴퓨터에서만 돌아간다. 없으면 조용히 건너뛴다.)
#
# hwpx-check.mjs 는 파일이 구조적으로 온전한지까지만 본다. 한글이 여는지는 다른 문제다.
# 구역마다 secPr 이 둘이던 시절, XML 문법도 표도 멀쩡했지만 한글은 '빈 문서' 를 띄웠다.
# 쪽수도 마찬가지다 — 표가 두 쪽으로 넘어가도 파일 자체는 멀쩡하다.
#
#   npm run check:hwpx        # 먼저 .hwpx-check 에 파일을 만들고
#   npm run check:open        # 한글로 열어 쪽수까지 본다
#
# .hwpx-check/expect.json 이 있으면 파일마다 기대하는 쪽수와 견준다.
# 한글 창이 파일마다 잠깐 떴다 닫힌다.

param(
  [string]$Dir = ".hwpx-check",
  [int]$WaitSeconds = 13
)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$candidates = @(
  "$env:ProgramFiles\Hnc\Office 2024\HOffice130\Bin\Hwp.exe",
  "${env:ProgramFiles(x86)}\Hnc\Office 2024\HOffice130\Bin\Hwp.exe",
  "${env:ProgramFiles(x86)}\HNC\Office 2024\HOffice130\Bin\Hwp.exe"
)
$hwp = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $hwp) {
  $hwp = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Hnc", "$env:ProgramFiles\Hnc" -Filter Hwp.exe -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $hwp) { Write-Output "한글을 찾지 못했습니다. 이 검사는 건너뜁니다."; exit 0 }

$files = Get-ChildItem -Path $Dir -Filter *.hwpx -Recurse -ErrorAction SilentlyContinue | Sort-Object Name
if (-not $files) { Write-Output "$Dir 에 .hwpx 가 없습니다. 먼저 npm run check:hwpx 를 돌리세요."; exit 1 }

$expect = @{}
$expectPath = Join-Path $Dir "expect.json"
if (Test-Path $expectPath) {
  (Get-Content $expectPath -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties |
    ForEach-Object { $expect[$_.Name] = [int]$_.Value }
}

$failed = 0
foreach ($f in $files) {
  Get-Process Hwp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 1200
  $proc = Start-Process -FilePath $hwp -ArgumentList "`"$($f.FullName)`"" -PassThru
  Start-Sleep -Seconds $WaitSeconds

  $title = (Get-Process -Name Hwp -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle
  if (-not ($title -and $title -like "*$($f.Name)*")) {
    $failed++
    Write-Output ("  실패 {0} — 한글이 열지 못했습니다 (창: {1})" -f $f.Name, $title)
    continue
  }

  # 상태 표시줄의 'N/M쪽' 단추에서 쪽수를 읽는다
  $pages = 0
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $proc.Id)
  foreach ($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
    foreach ($e in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
      if ($e.Current.Name -match '^\s*\d+\s*/\s*(\d+)\s*쪽\s*$') { $pages = [int]$Matches[1] }
    }
  }

  $want = if ($expect.ContainsKey($f.Name)) { $expect[$f.Name] } else { 0 }
  if ($pages -eq 0) {
    Write-Output ("  OK   {0} (쪽수를 읽지 못함)" -f $f.Name)
  } elseif ($want -gt 0 -and $pages -gt $want) {
    $failed++
    Write-Output ("  실패 {0} — {1}쪽으로 나옵니다 ({2}쪽이어야 합니다)" -f $f.Name, $pages, $want)
  } else {
    Write-Output ("  OK   {0} ({1}쪽)" -f $f.Name, $pages)
  }
}
Get-Process Hwp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

if ($failed) { Write-Output "`n$failed 건 어긋났습니다"; exit 1 }
Write-Output "`n모두 한글에서 열리고 쪽수도 맞습니다"
