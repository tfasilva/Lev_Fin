<?php
// Adiciona classes variante (status/payment) aos painéis de controle
$f = 'G:\Meu Drive\Projetos TADS\WebPizzariaV2\assets\site.js';
$t = file_get_contents($f);

$old = '<div class="order-controls"><select aria-label="Status do pedido"';
$new = '<div class="order-controls status"><select aria-label="Status do pedido"';
if (str_contains($t, $old)) {
    $t = str_replace($old, $new, $t);
    echo "status class OK\n";
} else echo "status NAO\n";

$old2 = '<div class="order-controls"><select aria-label="Status do pagamento"';
$new2 = '<div class="order-controls payment"><select aria-label="Status do pagamento"';
if (str_contains($t, $old2)) {
    $t = str_replace($old2, $new2, $t);
    echo "payment class OK\n";
} else echo "payment NAO\n";

// botões ganham classe de ícone visual
$t = str_replace('>Atualizar</button>', '>Atualizar ⟳</button>', $t);
$t = str_replace('>Pagamento</button>', '>Salvar $</button>', $t);

file_put_contents($f, $t);
