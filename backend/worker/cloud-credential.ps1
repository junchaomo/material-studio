param([ValidateSet('create','read','hash')][string]$Mode='hash')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$taskFile=Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.local\cloud-worker-key.dpapi'
if($Mode -eq 'create'){
 if(Test-Path -LiteralPath $taskFile){throw 'Cloud processor credential already exists'}
 $taskKey=[byte[]]::new(32)
 [Security.Cryptography.RandomNumberGenerator]::Fill($taskKey)
 $taskBytes=[Text.Encoding]::UTF8.GetBytes([Convert]::ToHexString($taskKey).ToLowerInvariant())
 [IO.File]::WriteAllBytes($taskFile,[Security.Cryptography.ProtectedData]::Protect($taskBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
}else{
 $taskBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($taskFile),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
}
if($Mode -eq 'read'){[Text.Encoding]::UTF8.GetString($taskBytes)}else{[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($taskBytes)).ToLowerInvariant()}
