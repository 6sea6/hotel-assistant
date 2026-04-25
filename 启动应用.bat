@echo off
chcp 65001 >nul
title 宾馆比较助手
cd /d "%~dp0"
echo 正在启动宾馆比较助手...
npm start
