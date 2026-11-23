<?php
// Exibir ingredientes abaixo da descrição no cardápio
$f = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/assets/site.js';
$t = file_get_contents($f);
$old = '<div class="product-info"><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p>';
$new = '<div class="product-info"><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p>${product.ingredients ? `<small class="product-ingredients">${escapeHtml(product.ingredients)}</small>` : \'\'}';
if (str_contains($t, $old)) {
    $t = str_replace($old, $new, $t);
    echo "cardapio ingredientes OK\n";
} else echo "cardapio NAO\n";
file_put_contents($f, $t);
