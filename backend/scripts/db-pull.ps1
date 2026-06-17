$remoteDump = Join-Path $env:TEMP "mdc_remote_dump.sql"
Write-Host "Pulling data from remote Hostinger DB..." -ForegroundColor Cyan
mysqldump --host=153.92.15.82 --port=3306 --user=u774697221_mdc --password=Mdc_0529 --quick --skip-column-statistics u774697221_mdc -r $remoteDump 2>&1 | Where-Object {$_ -notmatch "^mysqldump:.*Warning"}
if ($LASTEXITCODE -ne 0) { Write-Host "Dump failed" -ForegroundColor Red; exit 1 }
Write-Host "Remote dump saved ($(Get-Item $remoteDump | Select-Object -ExpandProperty Length) bytes)" -ForegroundColor Green

Write-Host "Importing into local mdc..." -ForegroundColor Cyan
Get-Content $remoteDump -Raw | mysql --user=root --password=00000000 mdc 2>&1 | Where-Object {$_ -notmatch "^mysql:.*Warning"}
if ($LASTEXITCODE -ne 0) { Write-Host "Import failed" -ForegroundColor Red; exit 1 }

Write-Host "Done! Local DB synced from remote." -ForegroundColor Green
mysql --user=root --password=00000000 mdc -e "SELECT 'profiles' AS t, COUNT(*) AS c FROM profiles UNION ALL SELECT 'parts',COUNT(*) FROM parts UNION ALL SELECT 'serial_numbers',COUNT(*) FROM serial_numbers UNION ALL SELECT 'transfers',COUNT(*) FROM transfers UNION ALL SELECT 'sites',COUNT(*) FROM sites" --table 2>&1 | Where-Object {$_ -notmatch "Warning"}
