# Pruebas de base de datos: crea un PostgreSQL efímero, aplica las migraciones
# reales y ejecuta las pruebas de seguridad/RLS de tests/db.
# Uso: .\scripts\test-db.ps1   (o con -KeepCluster para explorar)
param(
  [switch]$KeepCluster
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin = Split-Path -Parent (Get-Command psql).Source
$port = 55432
$pgdata = Join-Path $env:TEMP 'alarma_vecinal_pgdata'
$log = Join-Path $env:TEMP 'alarma_vecinal_pg.log'
$db = 'alarma_test'
$psql = Join-Path $bin 'psql.exe'
$pgCtl = Join-Path $bin 'pg_ctl.exe'

function Test-Port([int]$PortNumber) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $PortNumber)
    return $true
  }
  catch { return $false }
  finally { $client.Close() }
}

function Invoke-Psql {
  param([string[]]$PsqlArgs)
  & $psql -h 127.0.0.1 -p $port -U postgres -d $db -v ON_ERROR_STOP=1 -q @PsqlArgs | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "psql falló con código $LASTEXITCODE (ver salida arriba)"
  }
}

Write-Host '=> Preparando clúster temporal…'
if (Test-Path $pgdata) {
  if (Test-Path (Join-Path $pgdata 'postmaster.pid')) {
    & $pgCtl -D $pgdata stop -m immediate | Out-Null
  }
  Remove-Item -Recurse -Force $pgdata
}
Remove-Item $log -ErrorAction SilentlyContinue

& (Join-Path $bin 'initdb.exe') -D $pgdata -U postgres --auth=trust -E UTF8 --no-locale | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'initdb falló' }

# Configuración por archivo: evita problemas de quoting con -o.
Add-Content -Path (Join-Path $pgdata 'postgresql.auto.conf') -Value "port = $port"
Add-Content -Path (Join-Path $pgdata 'postgresql.auto.conf') -Value "listen_addresses = '127.0.0.1'"

# pg_ctl hereda manejadores de la sesión: se lanza en consola aparte.
Start-Process -FilePath $pgCtl -ArgumentList @('-D', $pgdata, '-l', $log, 'start') -WindowStyle Hidden | Out-Null

$ready = $false
for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Port $port) { $ready = $true }
}
if (-not $ready) {
  Get-Content $log -Tail 20 -ErrorAction SilentlyContinue
  throw 'No se pudo iniciar PostgreSQL'
}

try {
  & (Join-Path $bin 'createdb.exe') -h 127.0.0.1 -p $port -U postgres $db
  if ($LASTEXITCODE -ne 0) { throw 'createdb falló' }

  $files = @(
    'tests\db\00_mock_supabase.sql',
    'supabase\migrations\0001_initial_schema.sql',
    'supabase\migrations\0002_functions.sql',
    'supabase\migrations\0003_rls.sql',
    'supabase\migrations\0004_seed.sql',
    'supabase\migrations\0005_seed_emergency_contacts.sql',
    'supabase\migrations\0006_admin_notifications.sql',
    'supabase\migrations\0007_profile_grant.sql',
    'supabase\migrations\0008_estoy_bien.sql',
    'supabase\migrations\0010_precaucion.sql',
    'tests\db\10_tests.sql',
    'tests\db\11_estoy_bien_tests.sql',
    'tests\db\12_precaucion_tests.sql'
  )

  foreach ($file in $files) {
    Write-Host "=> $file"
    Invoke-Psql -PsqlArgs @('-f', (Join-Path $root $file))
  }

  Write-Host ''
  Write-Host '=== PRUEBAS DE BASE DE DATOS: OK ===' -ForegroundColor Green
}
finally {
  if (-not $KeepCluster) {
    & $pgCtl -D $pgdata stop -m immediate | Out-Null
    Remove-Item -Recurse -Force $pgdata -ErrorAction SilentlyContinue
  }
  else {
    Write-Host "Clúster conservado en $pgdata (puerto $port)"
  }
}
