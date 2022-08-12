@echo off

title Download

:loop

node ./lib/download.js Diff

goto :loop

pause
