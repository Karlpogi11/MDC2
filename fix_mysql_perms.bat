@echo off
echo Step 1: Killing orphaned mysqld processes...
taskkill /f /im mysqld.exe 2>nul
timeout /t 5 /nobreak >nul

echo Step 2: Taking ownership of MySQL Data directory...
takeown /f "C:\ProgramData\MySQL\MySQL Server 8.0\Data" /r /d y

echo Step 3: Resetting and granting permissions...
icacls "C:\ProgramData\MySQL\MySQL Server 8.0\Data" /reset /t /q
icacls "C:\ProgramData\MySQL\MySQL Server 8.0\Data" /grant "NETWORK SERVICE:(OI)(CI)F" /t
icacls "C:\ProgramData\MySQL\MySQL Server 8.0\Data" /grant "SYSTEM:(OI)(CI)F" /t

echo Step 4: Starting MySQL service...
net start MySQL80
if %errorlevel%==0 (
    echo SUCCESS: MySQL is running.
) else (
    echo FAILED. Check: C:\ProgramData\MySQL\MySQL Server 8.0\Data\DESKTOP-MAMI860.err
)
pause
