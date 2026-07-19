@echo off
cd /d "%~dp0"
echo Starting Nespakono AI Architecture Studio...
echo.
echo [1/3] Checking requirements...
python -m pip install fastapi uvicorn python-multipart flask flask-cors requests python-dotenv replicate > nul 2>&1

echo [2/3] Starting Local Servers...
start "Frontend" cmd /k "python -m uvicorn backend.main:app --host 127.0.0.1 --port 8888"
start "Backend" cmd /k "python backend\app.py"

echo [3/3] Opening Browser...
timeout /t 3 /nobreak > nul
start http://127.0.0.1:8888

echo Started successfully!
pause
