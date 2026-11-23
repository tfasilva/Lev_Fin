<?php
$api = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/api.php';
$a = file_get_contents($api);
$bad = "log_audit(\$user ?? null, 'Cardápio', 'product_save', \"Produto #{\$id ?? 'novo'} {\$name}\");";
$good = "log_audit(\$user ?? null, 'Cardápio', 'product_save', 'Produto ' . (\$id ?: 'novo') . ' ' . \$name);";
if (str_contains($a, $bad)) {
    $a = str_replace($bad, $good, $a);
    echo "fixed\n";
} else echo "not found\n";
file_put_contents($api, $a);
