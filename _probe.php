<?php
// Separar controles: status do pedido (order_status) e pagamento (payment_status) em blocos distintos
$f = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/assets/site.js';
$t = file_get_contents($f);

$old = '${canUpdatePayment ? `<div class="order-controls"><select aria-label="Status do pedido" data-order-status="${id}">${Object.entries(orderStatusLabels).map(([status, label]) => `<option value="${status}" ${status === order.status ? \'selected\' : \'\'}>${label}</option>`).join(\'\')}</select><button class="button button-small button-outline" data-save-order="${id}">Atualizar</button>';
$i = $t.IndexOf('<div class="order-controls">');
echo "ctx: " . ($i >= 0 ? "found" : "no") . "\n";
// usa substring approach: encontra o bloco inteiro do template order-controls
$j = $t.IndexOf('${canUpdatePayment ?');
$k = $t.IndexOf(': paymentRequestStatus}', $j);
echo "block: $j..$k\n";
file_put_contents('G:/Meu Drive/Projetos TADS/Lev_Fin/_block.txt', $t.Substring($j, $k - $j + strlen(': paymentRequestStatus}')));
