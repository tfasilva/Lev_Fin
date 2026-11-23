<?php
// Meio a meio: valor cobrado = maior dos dois preços proporcionais (prática de pizzaria)
// e descrição mostra os dois valores proporcionais ao tamanho escolhido.
$f = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/includes/bootstrap.php';
$t = file_get_contents($f);
$old = '$priceCents = intdiv($priceCents + $secondCents + 1, 2);';
$new = '$priceCents = max($firstFlavorCents, $secondFlavorCents); // proporção justa: cobra o sabor mais caro, nunca abaixo do valor real';
if (str_contains($t, $old)) {
    $t = str_replace($old, $new, $t);
    echo "half pricing OK\n";
} else echo "half NAO\n";
file_put_contents($f, $t);
