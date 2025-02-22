@echo off

title Download-Full

:loop

node ./lib/download.js Full

goto :loop

pause
