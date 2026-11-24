@echo off
rem pine, as the Pine app carries it on Windows: the app's own pine on the app's own Node. The
rem installer puts this folder (resources\bin) into the user's PATH (scripts\installer.nsh), so
rem that `pine` works in a terminal where neither Node nor pine was ever installed.
setlocal
set "PINE_APP=%~dp0.."
if not exist "%PINE_APP%\node\node.exe" goto gone
if not exist "%PINE_APP%\pine\bin\pine.js" goto gone
"%PINE_APP%\node\node.exe" "%PINE_APP%\pine\bin\pine.js" %*
exit /b %ERRORLEVEL%
:gone
echo This pine belongs to the Pine app, and the app is not whole where it was (%PINE_APP%). Install Pine again with its installer. 1>&2
exit /b 1
