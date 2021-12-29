@echo off

title Download

:loop

node ./lib/download.js

goto :loop

pause
