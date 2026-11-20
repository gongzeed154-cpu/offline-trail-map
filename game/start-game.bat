@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ยังไม่ได้ติดตั้ง Node.js — ติดตั้งจาก https://nodejs.org แล้วเปิดไฟล์นี้ใหม่
  pause
  exit /b 1
)
rem เปิดเซิร์ฟเวอร์ในหน้าต่างของตัวเอง (ปิดหน้าต่างนั้นเมื่อไหร่ เกมหยุดทันที) แล้วรอให้พร้อมก่อนเปิดเบราว์เซอร์
start "เซิร์ฟเวอร์เกม - ห้ามปิดตลอดเกม" cmd /k node server.js
timeout /t 3 /nobreak >nul
start "" http://localhost:3000/host
echo.
echo เปิดหน้าจอครูแล้ว: http://localhost:3000/host
echo ถ้าแผนที่ไม่ขึ้น เปิดหน้าตรวจระบบ: http://localhost:3000/check
echo (หน้าต่างนี้ปิดได้ แต่ห้ามปิดหน้าต่าง "เซิร์ฟเวอร์เกม")
pause
