@echo off

@title Message Count

:loop

node ./lib/msg-cnt.js
@cls

goto loop

pause
