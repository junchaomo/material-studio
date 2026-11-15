param([ValidateSet('create','read')][string]$Mode='read')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$taskFile=Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.local\worker-key.dpapi'
if($Mode -eq 'create'){
 if(Test-Path -LiteralPath $taskFile){throw 'Worker credential already exists'}
 $taskKey=[byte[]]::new(32)
 [Security.Cryptography.RandomNumberGenerator]::Fill($taskKey)
 $taskText=[Convert]::ToHexString($taskKey).ToLowerInvariant()
 $taskBytes=[Text.Encoding]::UTF8.GetBytes($taskText)
 [IO.File]::WriteAllBytes($taskFile,[Security.Cryptography.ProtectedData]::Protect($taskBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 $taskDigest=[Security.Cryptography.SHA256]::HashData($taskBytes)
 [Convert]::ToHexString($taskDigest).ToLowerInvariant()
}else{
 $taskBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($taskFile),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 [Text.Encoding]::UTF8.GetString($taskBytes)
}
