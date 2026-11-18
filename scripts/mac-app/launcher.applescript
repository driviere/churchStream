-- ChurchStream.app: starts ChurchStream (inside this app) without a Terminal window.
-- Compiled by scripts/build-exe.js with `osacompile -s` (a stay-open app).
--   Open the app        → ChurchStream starts and the browser opens the control panel.
--   Click its Dock icon → the control panel opens again.
--   Quit (⌘Q / Dock)    → ChurchStream and FFmpeg stop.
-- Settings, songs, services and recordings live in ~/ChurchStream-data, outside the app, so
-- the app can be replaced by a newer version (and macOS may run it from a read-only copy).
-- Globals, not properties: properties would be written back into the app on quit, which
-- breaks its signature.

global serverPid, dataDir, appPath

on run
	set appPath to POSIX path of (path to me)
	if appPath ends with "/" then set appPath to text 1 thru -2 of appPath
	set dataDir to (POSIX path of (path to home folder)) & "ChurchStream-data"
	set res to appPath & "/Contents/Resources"
	set folderPath to do shell script "/usr/bin/dirname " & quoted form of appPath
	set oldData to folderPath & "/ChurchStream-data"
	-- Coming from an older ChurchStream (data next to the program): bring the data along once.
	do shell script "if [ -d " & quoted form of oldData & " ] && [ ! -e " & quoted form of dataDir & " ]; then /usr/bin/ditto " & quoted form of oldData & " " & quoted form of dataDir & "; fi; /bin/mkdir -p " & quoted form of (dataDir & "/run") & "; /bin/rm -f " & quoted form of (dataDir & "/run/url.txt")
	-- Files downloaded from the internet are marked by macOS; clear that so FFmpeg may run.
	do shell script "/usr/bin/xattr -dr com.apple.quarantine " & quoted form of appPath & " 2>/dev/null; true"
	-- Already running (opened twice, or started from Terminal)? Just show the control panel.
	set running to do shell script "/usr/bin/pgrep -f " & quoted form of (res & "/ChurchStream") & " || true"
	if running is not "" then
		set serverPid to first paragraph of running
		openControl()
		return
	end if
	set logFile to dataDir & "/run/churchstream.log"
	set serverPid to do shell script "cd " & quoted form of res & " && CHURCHSTREAM_DATA=" & quoted form of dataDir & " ./ChurchStream > " & quoted form of logFile & " 2>&1 & echo $!"
end run

-- Clicking the Dock icon again opens the control panel.
on reopen
	openControl()
end reopen

on openControl()
	repeat 20 times
		try
			set u to do shell script "/bin/cat " & quoted form of (dataDir & "/run/url.txt")
			if u is not "" then
				open location u
				return
			end if
		end try
		delay 0.5
	end repeat
end openControl

-- If ChurchStream stops by itself, say so and close the app.
on idle
	try
		do shell script "/bin/kill -0 " & serverPid
	on error
		set lastLines to ""
		try
			set lastLines to do shell script "/usr/bin/tail -6 " & quoted form of (dataDir & "/run/churchstream.log")
		end try
		display dialog "ChurchStream stopped." & return & return & lastLines buttons {"OK"} default button 1 with title "ChurchStream" with icon caution
		quit
	end try
	return 5
end idle

on quit
	try
		do shell script "/bin/kill -TERM " & serverPid & " 2>/dev/null; for i in 1 2 3 4 5 6 7 8 9 10 11 12; do /bin/kill -0 " & serverPid & " 2>/dev/null || exit 0; /bin/sleep 0.5; done; /bin/kill -9 " & serverPid & " 2>/dev/null; true"
	end try
	continue quit
end quit
