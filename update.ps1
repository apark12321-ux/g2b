# 다운로드 폴더의 최신 g2b-v*.zip 을 이 저장소에 덮어쓰고 GitHub에 올립니다.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repo
Write-Host ""
Write-Host "  나라장터 입찰 알림 업데이트" -ForegroundColor Cyan
Write-Host ""

# 1. 최신 압축 파일 찾기
$dl = Join-Path $env:USERPROFILE 'Downloads'
try {
  $p = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
  if ($p) { $dl = $p }
} catch {}
$zip = Get-ChildItem -Path $dl -Filter 'g2b-v*.zip' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) {
  Write-Host "  다운로드 폴더에 g2b-v*.zip 파일이 없습니다." -ForegroundColor Red
  Write-Host "  찾은 위치: $dl"
  exit 1
}
$ver = [IO.Path]::GetFileNameWithoutExtension($zip.Name)
Write-Host "  [1/3] $($zip.Name) 압축 푸는 중"
$tmp = Join-Path $env:TEMP ("g2b-update-" + [guid]::NewGuid())
Expand-Archive -Path $zip.FullName -DestinationPath $tmp -Force
$items = @(Get-ChildItem $tmp -Force)
if ($items.Count -eq 1 -and $items[0].PSIsContainer) { $src = $items[0].FullName } else { $src = $tmp }

# 2. 덮어쓰기 (.git, node_modules 는 건드리지 않음)
Write-Host "  [2/3] 파일 덮어쓰는 중"
robocopy $src $repo /E /NFL /NDL /NJH /NJS /NP /XD .git node_modules | Out-Null
if ($LASTEXITCODE -ge 8) { throw "파일 복사 실패 (robocopy 코드 $LASTEXITCODE)" }
$rm = Join-Path $repo '.removed'
if (Test-Path $rm) {
  Get-Content $rm -Encoding UTF8 | Where-Object { $_.Trim() } | ForEach-Object {
    $f = Join-Path $repo $_.Trim()
    if (Test-Path $f) { Remove-Item $f -Recurse -Force; Write-Host "        삭제: $($_.Trim())" }
  }
  Remove-Item $rm -Force
}
Remove-Item $tmp -Recurse -Force

# 3. GitHub에 올리기
$ErrorActionPreference = 'Continue'
Write-Host "  [3/3] GitHub에 올리는 중"
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) {
  $git = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $git) {
  Write-Host ""
  Write-Host "  파일은 덮어썼습니다. GitHub Desktop 에서 Commit, Push origin 을 눌러 주세요." -ForegroundColor Yellow
  exit 0
}
& $git add -A
& $git commit -q -m "update $ver"
& $git push -q
Write-Host ""
if ($LASTEXITCODE -ne 0) {
  Write-Host "  파일은 덮어썼지만 GitHub에 올리지 못했습니다." -ForegroundColor Yellow
  Write-Host "  GitHub Desktop 을 열고 Push origin 을 눌러 주세요." -ForegroundColor Yellow
} else {
  Write-Host "  완료: $ver 을(를) 올렸습니다. 1~2분 뒤 사이트에 반영됩니다." -ForegroundColor Green
}
