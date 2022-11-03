@echo off

title Search-Diff

:loop

node ./lib/search.js Diff

goto :loop

pause
