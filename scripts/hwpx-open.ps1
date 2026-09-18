# 만들어진 .hwpx 를 한글로 실제로 열어 본다 (윈도우 + 한글이 깔린 컴퓨터에서만).
#
# hwpx-check.mjs 는 파일이 구조적으로 온전한지까지만 본다. 한글이 여는지는 다른 문제다.
# 실제로 구역마다 secPr 이 둘이던 시절, XML 문법도 표도 멀쩡했지만 한글은 '빈 문서' 를 띄웠다.
# 그래서 서식이나 hwpxDoc.ts 를 고친 뒤에는 이 검사를 한 번 돌린다.
#
#   npm run check:hwpx        # 먼저 .hwpx-check 에 파일을 만들고
#   npm run check:open        # 한글로 열어 본다
#
# 한글 창이 잠깐 떴다 닫힌다. 열린 문서의 제목이 파일 이름과 같으면 통과,
# '빈 문서' 가 뜨면 한글이 그 파일을 읽지 못한 것이다.

param(
  [string]$Dir = ".hwpx-check",
  [int]$WaitSeconds = 13
)

$candidates = @(
  "$env:ProgramFiles\Hnc\Office 2024\HOffice130\Bin\Hwp.exe",
  "${env:ProgramFiles(x86)}\Hnc\Office 2024\HOffice130\Bin\Hwp.exe",
  "${env:ProgramFiles(x86)}\HNC\Office 2024\HOffice130\Bin\Hwp.exe"
)
$hwp = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $hwp) {
  # 설치 위치가 다르면 찾아본다
  $hwp = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Hnc", "$env:ProgramFiles\Hnc" -Filter Hwp.exe -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $hwp) { Write-Output "한글을 찾지 못했습니다. 이 검사는 건너뜁니다."; exit 0 }

$files = Get-ChildItem -Path $Dir -Filter *.hwpx -ErrorAction SilentlyContinue | Sort-Object Name
if (-not $files) { Write-Output "$Dir 에 .hwpx 가 없습니다. 먼저 npm run check:hwpx 를 돌리세요."; exit 1 }

$failed = 0
foreach ($f in $files) {
  Get-Process Hwp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 1200
  Start-Process -FilePath $hwp -ArgumentList "`"$($f.FullName)`"" | Out-Null
  Start-Sleep -Seconds $WaitSeconds
  $title = (Get-Process -Name Hwp -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle
  if ($title -and $title -like "*$($f.Name)*") {
    Write-Output ("  OK   {0}" -f $f.Name)
  } else {
    $failed++
    Write-Output ("  실패 {0}  — 한글 창: {1}" -f $f.Name, $title)
  }
}
Get-Process Hwp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

if ($failed) { Write-Output "`n$failed 개 파일을 한글이 열지 못했습니다"; exit 1 }
Write-Output "`n모두 한글에서 열립니다"
