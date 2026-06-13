$mysqlDir = "C:\Program Files\MySQL\MySQL Server 8.0"
$dataDir = "C:\ProgramData\MySQL\MySQL Server 8.0"
$myIni = "$dataDir\my.ini"
$initSql = "C:\Users\K\Desktop\MDC2\mysql_init.sql"

"ALTER USER 'root'@'localhost' IDENTIFIED BY '00000000';" | Out-File -FilePath $initSql -Encoding ASCII

Stop-Service MySQL80 -Force
Start-Sleep -Seconds 5
Get-Process -Name mysqld -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

# Run mysqld with init-file (this will run the SQL and then the server continues running)
$logFile = "$env:TEMP\mysql_init_log.txt"
$proc = Start-Process -FilePath "$mysqlDir\bin\mysqld" -ArgumentList "--defaults-file=$myIni --init-file=$initSql" -NoNewWindow -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $logFile

Start-Sleep -Seconds 10

# Check if it started successfully by looking for the service port
$connected = $false
for ($i = 0; $i -lt 10; $i++) {
    try {
        $result = & "$mysqlDir\bin\mysql" -u root -p00000000 -e "SELECT 1" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $connected = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 2
}

if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
Start-Sleep -Seconds 3
Start-Service MySQL80

if ($connected) { "SUCCESS" } else { "FAILED" } | Out-File -FilePath "$env:TEMP\mysql_reset_result.txt"
