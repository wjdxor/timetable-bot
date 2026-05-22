# 매일 오전 7시 시간표 봇 자동 실행 등록
# 관리자 권한 없이 현재 사용자로 등록됩니다.

$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodePath) {
    Write-Error "Node.js가 설치되어 있지 않습니다. 설치 후 다시 실행하세요."
    exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BotScript = Join-Path $ScriptDir "bot.js"

$Action = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument "`"$BotScript`"" `
    -WorkingDirectory $ScriptDir

$Trigger = New-ScheduledTaskTrigger -Daily -At "07:00"

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable `
    -DontStopOnIdleEnd

Register-ScheduledTask `
    -TaskName "TimetableBot" `
    -TaskPath "\TimetableBot\" `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "매일 오전 7시 컴시간 시간표를 텔레그램으로 전송" `
    -RunLevel Limited `
    -Force

Write-Host "✅ 작업 스케줄러 등록 완료! 매일 오전 7시에 시간표가 전송됩니다." -ForegroundColor Green
Write-Host "   확인: 작업 스케줄러 → \TimetableBot\TimetableBot" -ForegroundColor Cyan
