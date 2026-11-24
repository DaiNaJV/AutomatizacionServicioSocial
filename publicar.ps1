# Publica la página en GitHub Pages con un solo comando.
# Uso desde la terminal de VS Code:   .\publicar.ps1
# o con mensaje propio:               .\publicar.ps1 "Cambié los colores"
# o con el atajo Ctrl+Shift+B (tarea "Publicar en GitHub Pages").

param([string]$Mensaje = "")

$Url = "https://dainajv.github.io/AutomatizacionServicioSocial/"
Set-Location -Path $PSScriptRoot

function Paso($texto){ Write-Host "`n> $texto" -ForegroundColor Cyan }
function Falla($texto){ Write-Host "`nNo se pudo publicar: $texto" -ForegroundColor Red; exit 1 }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Falla "Git no está instalado o no está en el PATH." }
if (-not (Test-Path ".git")) { Falla "esta carpeta no es el repositorio. Abre en VS Code la carpeta AutomatizacionServicioSocial." }

$rama = (git rev-parse --abbrev-ref HEAD).Trim()

Paso "Buscando cambios"
$cambios = git status --porcelain
if (-not $cambios) {
  Write-Host "No hay cambios nuevos. La página ya está al día: $Url" -ForegroundColor Yellow
  exit 0
}
$cambios | ForEach-Object { Write-Host "  $_" }

if (-not $Mensaje) { $Mensaje = "Actualización del " + (Get-Date -Format "dd/MM/yyyy HH:mm") }

# Marca de versión para saber cuándo GitHub Pages ya publicó este cambio
$version = Get-Date -Format "yyyyMMddHHmmss"
Set-Content -Path "version.txt" -Value $version -Encoding ascii

Paso "Guardando cambios (commit)"
git add -A
git commit -m "$Mensaje" | Out-Host
if ($LASTEXITCODE -ne 0) { Falla "el commit falló. Revisa el mensaje de arriba." }

Paso "Trayendo cambios del repositorio en GitHub"
git pull --rebase origin $rama | Out-Host
if ($LASTEXITCODE -ne 0) { Falla "hay conflictos con lo que está en GitHub. Resuélvelos en VS Code (Control de código fuente) y vuelve a correr el script." }

Paso "Subiendo a GitHub (push)"
git push origin $rama | Out-Host
if ($LASTEXITCODE -ne 0) { Falla "el push falló. Si te pidió usuario y contraseña, usa un token de GitHub en lugar de tu contraseña." }

Paso "Esperando a que GitHub Pages publique la nueva versión"
$commit = (git rev-parse --short HEAD).Trim()
$listo = $false
for ($i = 1; $i -le 18; $i++) {
  Start-Sleep -Seconds 10
  try {
    $r = Invoke-WebRequest -Uri ($Url + "version.txt?nocache=" + [guid]::NewGuid()) -UseBasicParsing -TimeoutSec 10
    if ($r.Content.Trim() -eq $version) { $listo = $true; break }
  } catch { }
  Write-Host "  ...todavía publicando ($($i*10) s)"
}

if ($listo) {
  Write-Host "`nListo. Versión $commit publicada en $Url" -ForegroundColor Green
  Start-Process $Url
} else {
  Write-Host "`nLos cambios ya están en GitHub (versión $commit). Pages puede tardar un poco más; abre $Url en unos minutos y recarga con Ctrl+F5." -ForegroundColor Yellow
}
