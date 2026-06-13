$mysqlDir = "C:\Program Files\MySQL\MySQL Server 8.0"
$dataDir = "C:\ProgramData\MySQL\MySQL Server 8.0"
$myIni = "$dataDir\my.ini"

Stop-Service MySQL80 -Force
Start-Sleep -Seconds 3

# Check if mysqld is already running from a previous attempt
$existing = Get-Process -Name "mysqld" -ErrorAction SilentlyContinue
if ($existing) { $existing | Stop-Process -Force }

$proc = Start-Process -FilePath "$mysqlDir\bin\mysqld" -ArgumentList "--defaults-file=$myIni --skip-grant-tables --skip-networking" -NoNewWindow -PassThru
Start-Sleep -Seconds 8

# Try connecting and updating password
$env:Path = "$mysqlDir\bin;$env:Path"
mysql -u root -e "FLUSH PRIVILEGES; ALTER USER 'root'@'localhost' IDENTIFIED BY '00000000';" 2>&1
if ($LASTEXITCODE -ne 0) {
    mysql -u root -e "FLUSH PRIVILEGES; ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '00000000';" 2>&1
}

Stop-Process -Id $proc.Id -Force
Start-Sleep -Seconds 3

Start-Service MySQL80
