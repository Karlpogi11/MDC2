# Kill all mysqld processes
Get-Process -Name "mysqld" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 5

# Fix permissions on MySQL Data directory
$dataDir = "C:\ProgramData\MySQL\MySQL Server 8.0\Data"
icacls $dataDir /reset /t /q
icacls $dataDir /grant "SYSTEM:(OI)(CI)F" /t /q
icacls $dataDir /grant "NT SERVICE\MySQL80:(OI)(CI)F" /t /q

# Reset the init SQL file
"ALTER USER 'root'@'localhost' IDENTIFIED BY '00000000';" | Out-File -FilePath "C:\Users\K\Desktop\MDC2\mysql_init.sql" -Encoding ASCII

Write-Host "DONE - Now start MySQL80 service from services.msc"
