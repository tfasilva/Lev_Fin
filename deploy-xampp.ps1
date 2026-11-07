$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$privateRoot = 'C:\xampp\levfin'
$publicEntry = 'C:\xampp\htdocs\levfin-api.php'

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'api.php'))) { throw 'api.php não encontrado no projeto.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.env'))) { throw '.env não encontrado; não há configuração para implantar.' }
if (-not (Test-Path -LiteralPath 'C:\xampp\htdocs')) { throw 'Pasta do Apache do XAMPP não encontrada em C:\xampp\htdocs.' }

New-Item -ItemType Directory -Path $privateRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'api.php') -Destination (Join-Path $privateRoot 'api.php') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot '.env') -Destination (Join-Path $privateRoot '.env') -Force
$wrapper = "<?php`nrequire 'C:/xampp/levfin/api.php';`n"
[IO.File]::WriteAllText($publicEntry, $wrapper, [Text.UTF8Encoding]::new($false))
Write-Output 'API LevFin publicada no Apache do XAMPP; o .env está fora da raiz pública.'
