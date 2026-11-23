<?php
// Substitui o bloco de controles por dois blocos independentes
$f = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/assets/site.js';
$t = file_get_contents($f);

$j = strpos($t, '${canUpdatePayment ?');
$k = strpos($t, ': paymentRequestStatus}', $j);
$old = substr($t, $j, $k - $j + strlen(': paymentRequestStatus}'));

$new = '${canChangeStatus ? `<div class="order-controls"><select aria-label="Status do pedido" data-order-status="${id}">${Object.entries(orderStatusLabels).map(([status, label]) => `<option value="${status}" ${status === order.status ? \'selected\' : \'\'}>${label}</option>`).join(\'\')}</select><button class="button button-small button-outline" data-save-order="${id}">Atualizar</button></div>` : \'\'}${canUpdatePayment ? `<div class="order-controls"><select aria-label="Status do pagamento" data-payment-status="${id}">${Object.entries(paymentStatusLabels).map(([status, label]) => `<option value="${status}" ${status === order.payment_status ? \'selected\' : \'\'}>${label}</option>`).join(\'\')}</select><button class="button button-small button-outline" data-save-payment="${id}">Pagamento</button>${paymentRequestStatus}${pendingRequest}</div>` : paymentRequestStatus}';

$t = substr_replace($t, $new, $j, strlen($old));
// definir canChangeStatus perto de canUpdatePayment
$t = str_replace(
  "const canUpdatePayment = hasArea('payment_status');",
  "const canUpdatePayment = hasArea('payment_status');\n      const canChangeStatus = hasArea('order_status');",
  $t
);
file_put_contents($f, $t);
echo "controls split OK\n";
