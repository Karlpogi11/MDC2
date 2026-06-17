param([string]$tag = "")
if (-not $tag) {
  $latest = Get-ChildItem "$PSScriptRoot\..\src\db\migrations" -Filter "*.sql" | Sort-Object Name -Descending | Select-Object -First 1
  $tag = [System.IO.Path]::GetFileNameWithoutExtension($latest.Name)
}
$sqlFile = "$PSScriptRoot\..\src\db\migrations\$tag.sql"
if (-not (Test-Path $sqlFile)) { Write-Host "File not found: $sqlFile" -ForegroundColor Red; exit 1 }

Write-Host "Applying $tag.sql to remote Hostinger DB..." -ForegroundColor Cyan
Get-Content $sqlFile -Raw | mysql --host=153.92.15.82 --port=3306 --user=u774697221_mdc --password=Mdc_0529 u774697221_mdc 2>&1 | Where-Object {$_ -notmatch "Warning"}
if ($LASTEXITCODE -ne 0) { Write-Host "Failed" -ForegroundColor Red; exit 1 }
Write-Host "SQL applied. Now insert migration record..." -ForegroundColor Cyan

# Insert meta record so drizzle knows it was applied
$hash = (Get-FileHash $sqlFile -Algorithm SHA256).Hash.ToLower()
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$idx = (Get-Content "$PSScriptRoot\..\src\db\migrations\meta\_journal.json" | ConvertFrom-Json).entries.Count
mysql --host=153.92.15.82 --port=3306 --user=u774697221_mdc --password=Mdc_0529 u774697221_mdc -e "SET sql_mode='NO_AUTO_VALUE_ON_ZERO'; INSERT INTO __drizzle_migrations (id, hash, created_at) VALUES ($idx, '$hash', $now);" 2>&1 | Where-Object {$_ -notmatch "Warning"}

Write-Host "Done! $tag applied to production." -ForegroundColor Green
