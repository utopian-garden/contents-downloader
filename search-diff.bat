@echo off

title Search

:loop

node ./lib/search.js Diff

goto :loop

pause
