<?php
// Frontend: novas áreas de acesso na UI + labels
$f = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/assets/site.js';
$t = file_get_contents($f);
$old = <<< 'JS'
    ['payments', 'Pagamentos'],
JS;
$new = <<< 'JS'
    ['payments', 'Pagamentos'],
    ['payment_status', 'Alterar status de pagamento'],
    ['order_status', 'Alterar status do pedido'],
    ['kitchen', 'Tela da cozinha'],
    ['counter', 'Tela do balcão'],
    ['audit', 'Ver relatório de alterações'],
JS;
if (str_contains($t, $old)) {
    $t = str_replace($old, $new, $t);
    echo "areas UI OK\n";
} else echo "areas UI NAO\n";
file_put_contents($f, $t);
