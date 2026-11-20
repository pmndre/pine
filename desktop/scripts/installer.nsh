; What the Windows installer does besides putting the app in place (electron-builder's nsis.include,
; scripts/pack.mjs): the app's resources\bin, where pine.cmd lies, goes into the user's PATH, so
; that `pine` works in a terminal (electron/command.ts only looks whether it is there), and comes
; out again when the app is uninstalled. Only the user's own PATH is changed (HKCU), never the
; system's, and only the one entry: what else is in it stays as it was, in its order. A PATH too
; long for the installer to read whole is left alone, since writing back what was cut off would
; lose the rest of it.

!include WinMessages.nsh

; $0: a PATH; $2: a folder. $0 comes back without the folder, however often it was in it (Windows
; compares folders without regard to case, and so does StrCmp).
!macro pineDropFromPath UN
Function ${UN}pineDropFromPath
	Push $3
	Push $4
	Push $5
	Push $6
	Push $7
	StrCpy $3 ""
	StrCpy $4 $0
	StrCpy $0 ""
	next:
		StrCmp $4 "" done
		StrCpy $5 0
	find:
		StrCpy $6 $4 1 $5
		StrCmp $6 "" cut
		StrCmp $6 ";" cut
		IntOp $5 $5 + 1
		Goto find
	cut:
		StrCpy $7 $4 $5
		IntOp $5 $5 + 1
		StrCpy $4 $4 "" $5
		StrCmp $7 $2 next
		StrCmp $3 "" 0 more
		StrCpy $3 "1"
		StrCpy $0 $7
		Goto next
	more:
		StrCpy $0 "$0;$7"
		Goto next
	done:
	Pop $7
	Pop $6
	Pop $5
	Pop $4
	Pop $3
FunctionEnd
!macroend

!ifdef BUILD_UNINSTALLER
	!insertmacro pineDropFromPath "un."
!else
	!insertmacro pineDropFromPath ""
!endif

!macro customInstall
	Push $0
	Push $1
	Push $2
	ReadRegStr $0 HKCU "Environment" "Path"
	StrLen $1 $0
	IntOp $1 $1 + 1024
	IntCmp $1 ${NSIS_MAX_STRLEN} pine_path_kept 0 pine_path_kept
	StrCpy $2 "$INSTDIR\resources\bin"
	; Once, at the end: an update finds it there from before.
	Call pineDropFromPath
	StrCmp $0 "" 0 pine_path_after
	StrCpy $0 $2
	Goto pine_path_write
	pine_path_after:
	StrCpy $0 "$0;$2"
	pine_path_write:
	WriteRegExpandStr HKCU "Environment" "Path" $0
	SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
	pine_path_kept:
	Pop $2
	Pop $1
	Pop $0
!macroend

!macro customUnInstall
	Push $0
	Push $1
	Push $2
	ClearErrors
	ReadRegStr $0 HKCU "Environment" "Path"
	IfErrors pine_path_gone
	StrLen $1 $0
	IntOp $1 $1 + 16
	IntCmp $1 ${NSIS_MAX_STRLEN} pine_path_gone 0 pine_path_gone
	StrCpy $2 "$INSTDIR\resources\bin"
	Call un.pineDropFromPath
	WriteRegExpandStr HKCU "Environment" "Path" $0
	SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
	pine_path_gone:
	Pop $2
	Pop $1
	Pop $0
!macroend
