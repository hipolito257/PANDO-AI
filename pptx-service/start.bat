@echo off
title PANDO pptx-service (port 5053)
color 0B

set SERVICE=C:\Users\pablo\OneDrive\Desktop\CLAUDE CODE\PANDO\pptx-service

echo.
echo  [pptx-service] Iniciando en localhost:5053...
echo.

cd /d "%SERVICE%"

:: Check if venv exists, create if not
if not exist "%SERVICE%\venv\Scripts\python.exe" (
    echo  [1/3] Creando entorno virtual...
    py -m venv venv
    echo  [2/3] Instalando dependencias...
    call venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate.bat
)

echo  [3/3] Iniciando FastAPI...
echo.
python -m uvicorn main:app --host 127.0.0.1 --port 5053 --reload

echo.
echo  [!] Servicio detenido.
pause
