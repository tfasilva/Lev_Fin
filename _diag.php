<?php
// Diagnóstico: como o app decide renderizar header/admin shell nas páginas admin
$f = 'G:\Meu Drive\Projetos TADS\WebPizzariaV2\assets\site.js';
$t = file_get_contents($f);
foreach (['adminShell', 'ensureChrome', 'mountChrome', 'adminFrame', 'renderAdmin', 'buildAdmin', 'sidebar'] as $n) {
  echo "$n -> " . strpos($t, $n) . "\n";
}
$i = strpos($t, 'adminSidebar');
echo "adminSidebar: $i\n";
// onde está "Olá," saudação
$j = strpos($t, 'Olá');
echo "ola at $j\n";
echo substr($t, $j - 300, 600);
