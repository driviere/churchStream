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

-- Each step goes to ~/ChurchStream-data/run/app.log, so a start that goes wrong can be seen.
on logStep(msg)
	try
		do shell script "/bin/mkdir -p ~/ChurchStream-data/run; echo \"$(/bin/date '+%H:%M:%S') \"" & quoted form of msg & " >> ~/ChurchStream-data/run/app.log"
	end try
end logStep

on run
	try
		launchChurchStream()
	on error errMsg number errNum
		logStep("error " & errNum & ": " & errMsg)
		display dialog "ChurchStream couldn't start." & return & return & errMsg buttons {"OK"} default button 1 with title "ChurchStream" with icon stop
		quit
	end try
end run

on launchChurchStream()
	logStep("starting")
	set appPath to POSIX path of (path to me)
	if appPath ends with "/" then set appPath to text 1 thru -2 of appPath
	set dataDir to (POSIX path of (path to home folder)) & "ChurchStream-data"
	set res to appPath & "/Contents/Resources"
	set folderPath to do shell script "/usr/bin/dirname " & quoted form of appPath
	set oldData to folderPath & "/ChurchStream-data"
	-- Coming from an older ChurchStream (data next to the program): bring the data along once.
	-- (Checked by the settings file, not the folder: the start-up log above creates the folder.)
	do shell script "if [ -f " & quoted form of (oldData & "/config.json") & " ] && [ ! -f " & quoted form of (dataDir & "/config.json") & " ]; then /usr/bin/ditto " & quoted form of oldData & " " & quoted form of dataDir & "; fi; /bin/mkdir -p " & quoted form of (dataDir & "/run")
	logStep("data in " & dataDir)
	-- Files downloaded from the internet are marked by macOS; clear that so FFmpeg may run.
	do shell script "/usr/bin/xattr -dr com.apple.quarantine " & quoted form of appPath & " 2>/dev/null; true"
	-- Already running (opened twice, or started from Terminal)? Just show the control panel.
	-- The server writes its process number to run/server.pid when it starts.
	set pidFile to dataDir & "/run/server.pid"
	set existingPid to do shell script "p=$(/bin/cat " & quoted form of pidFile & " 2>/dev/null); if [ -n \"$p\" ] && /bin/kill -0 \"$p\" 2>/dev/null && /bin/ps -p \"$p\" -o comm= | /usr/bin/grep -q ChurchStream; then echo \"$p\"; fi"
	if existingPid is not "" then
		logStep("already running, process " & existingPid)
		set serverPid to existingPid
		openControl()
		return
	end if
	do shell script "/bin/rm -f " & quoted form of (dataDir & "/run/url.txt") & " " & quoted form of pidFile
	set logFile to dataDir & "/run/churchstream.log"
	logStep("app at " & appPath)
	-- No input and all output to the log: otherwise 'do shell script' waits for ChurchStream to
	-- finish, and the app can't answer Quit.
	set serverPid to do shell script "cd " & quoted form of res & " && CHURCHSTREAM_DATA=" & quoted form of dataDir & " /usr/bin/nohup ./ChurchStream < /dev/null > " & quoted form of logFile & " 2>&1 & echo $!"
	logStep("ChurchStream started, process " & serverPid)
end launchChurchStream

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
