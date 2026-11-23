$f = "G:\Meu Drive\Projetos TADS\WebPizzariaV2\assets\site.js"
$bytes = [System.IO.File]::ReadAllBytes($f)
# primeiro byte 0x3F '?' sugere BOM UTF-8 que virou lixo: verifica sequências
Write-Output ("bytes0-3: " + (($bytes[0..3] | ForEach-Object { $_.ToString('X2') }) -join ' '))
# Se for EF BB BF removido indevidamente antes, o '?' é literal 0x3F — remove se for
if ($bytes[0] -eq 0x3F -and $bytes[1] -eq 0x28) {
  # checa se arquivo original tinha BOM: procura primeira linhaoriginal no git? apenas remove o ? inicial
  $new = New-Object System.Collections.Generic.List[byte]
  $new.AddRange([byte[]]($bytes | Select-Object -Skip 1))
  [System.IO.File]::WriteAllBytes($f, [byte[]]$new.ToArray())
  Write-Output "removed leading '?'"
}
else { Write-Output "no leading ?" }
