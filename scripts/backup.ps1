[CmdletBinding()]
param(
  [string]$Destination,
  [SecureString]$EncryptionPassword
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $Destination) {
  $oneDrive = if ($env:OneDrive) { $env:OneDrive } else { 'C:\Users\Admin\OneDrive' }
  $Destination = Join-Path $oneDrive 'Archeon Solutions\MaturityFlow Backups'
}
$destinationPath = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$tempRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) "maturityflow-backup-$([guid]::NewGuid().ToString('N'))"))
$systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $tempRoot.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Refusing to create a backup staging folder outside the system temporary directory.'
}
New-Item -ItemType Directory -Path $tempRoot | Out-Null

try {
  $payload = Join-Path $tempRoot 'MaturityFlow'
  New-Item -ItemType Directory -Path $payload | Out-Null

  $git = (Get-Command git -ErrorAction Stop).Source
  & $git -C $workspace bundle create (Join-Path $payload 'repository.bundle') --all
  if ($LASTEXITCODE -ne 0) { throw 'Git bundle creation failed.' }
  $sourceArchive = Join-Path $payload 'source-at-head.zip'
  & $git -C $workspace archive --format=zip "--output=$sourceArchive" HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Source archive creation failed.' }

  $envFiles = @('.env', '.env.local')
  foreach ($name in $envFiles) {
    $source = Join-Path $workspace $name
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $payload $name) }
  }

  $storage = Join-Path $workspace 'storage'
  if (Test-Path -LiteralPath $storage) {
    Copy-Item -LiteralPath $storage -Destination (Join-Path $payload 'storage') -Recurse
  } else {
    New-Item -ItemType Directory -Path (Join-Path $payload 'storage') | Out-Null
  }

  $envPath = Join-Path $workspace '.env'
  $databaseLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
  if (-not $databaseLine) { throw 'DATABASE_URL is missing from .env.' }
  $databaseUrl = ($databaseLine -replace '^DATABASE_URL=', '').Trim().Trim('"').Trim("'")
  $uri = [Uri]$databaseUrl
  if ($uri.Host -notin @('localhost', '127.0.0.1')) {
    throw 'The laptop backup command only accepts the configured local PostgreSQL database.'
  }
  $userInfo = $uri.UserInfo.Split(':', 2)
  $dbUser = [Uri]::UnescapeDataString($userInfo[0])
  $dbPassword = if ($userInfo.Count -gt 1) { [Uri]::UnescapeDataString($userInfo[1]) } else { '' }
  $dbName = $uri.AbsolutePath.TrimStart('/')
  $pgDump = 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe'
  if (-not (Test-Path -LiteralPath $pgDump)) { $pgDump = (Get-Command pg_dump -ErrorAction Stop).Source }
  $oldPgPassword = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $dbPassword
    $databaseDump = Join-Path $payload 'database.dump'
    & $pgDump "--host=$($uri.Host)" "--port=$($uri.Port)" "--username=$dbUser" --format=custom --compress=9 "--file=$databaseDump" $dbName
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL dump failed.' }
  } finally {
    $env:PGPASSWORD = $oldPgPassword
    $dbPassword = $null
  }

  $commit = (& $git -C $workspace rev-parse HEAD).Trim()
  $files = Get-ChildItem -LiteralPath $payload -File -Recurse | ForEach-Object {
    [ordered]@{
      path = $_.FullName.Substring($payload.Length + 1).Replace('\', '/')
      bytes = $_.Length
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  $manifest = [ordered]@{
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    application = 'MaturityFlow'
    gitCommit = $commit
    database = $dbName
    includes = @('all Git refs', 'source snapshot at HEAD', 'local PostgreSQL custom dump', 'uploaded documents', 'local environment configuration')
    files = $files
  }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $payload 'restore-manifest.json') -Encoding utf8

  $sevenZip = 'C:\Program Files\7-Zip\7z.exe'
  if (-not (Test-Path -LiteralPath $sevenZip)) { throw '7-Zip is required for the recovery archive.' }
  $archive = Join-Path $destinationPath "MaturityFlow-$stamp.7z"
  $plainPassword = $null
  $testArguments = @('t', $archive)
  try {
    $arguments = @('a', '-t7z', '-mx=7', $archive, (Join-Path $payload '*'))
    if ($EncryptionPassword) {
      $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($EncryptionPassword)
      try { $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
      $arguments = @('a', '-t7z', '-mx=7', '-mhe=on', "-p$plainPassword", $archive, (Join-Path $payload '*'))
      $testArguments = @('t', "-p$plainPassword", $archive)
    } else {
      Write-Warning 'This archive relies on OneDrive account security. Pass -EncryptionPassword for portable AES-256 encryption.'
    }
    & $sevenZip @arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Recovery archive creation failed.' }
  } finally {
    $plainPassword = $null
  }

  & $sevenZip @testArguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Recovery archive verification failed.' }
  $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  [ordered]@{ archive = $archive; bytes = (Get-Item -LiteralPath $archive).Length; sha256 = $hash; gitCommit = $commit } | ConvertTo-Json
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
  if ($resolvedTemp.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
