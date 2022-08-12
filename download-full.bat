@echo off

title Download

:loop

node ./lib/download.js Full

goto :loop

pause
