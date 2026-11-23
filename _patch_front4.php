<?php
// Frontend: telas Cozinha/Balcão + regras de quem vê botões + página de auditoria
$f = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/assets/site.js';
$t = file_get_contents($f);

// 1. canUpdatePayment: apenas quem tem area payment_status
$old = "const canUpdatePayment = user && user.role !== 'cliente';";
$new = "const canUpdatePayment = hasArea('payment_status');";
if (str_contains($t, $old)) {
    $t = str_replace($old, $new, $t);
    echo "canUpdatePayment OK\n";
} else echo "cup NAO\n";

// 2. Status do pedido: mostrar select/botão só para quem tem order_status
$old2 = "const canReviewPayment = ['administrador', 'gerente', 'caixa'].includes(user?.role);";
$new2 = "const canReviewPayment = hasArea('payment_status') && ['administrador', 'gerente', 'caixa'].includes(user?.role);";
if (str_contains($t, $old2)) {
    $t = str_replace($old2, $new2, $t);
    echo "canReview OK\n";
} else echo "crv NAO\n";

file_put_contents($f, $t);
