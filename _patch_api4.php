<?php
// Regex-based patch para order_update / payment_update + audit
$api = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/api.php';
$a = file_get_contents($api);

$old = "case 'order_update':\n            api_require_area('orders', ['administrador', 'gerente', 'colaborador', 'caixa']);";
$new = "case 'order_update':\n            \$user = api_require_area('order_status', ['administrador', 'gerente', 'colaborador']);";
if (str_contains($a, $old)) {
    $a = str_replace($old, $new, $a);
    echo "order_update role OK\n";
} else {
    // tenta com quebras \r\n
    $oldCrlf = str_replace("\n", "\r\n", $old);
    $newCrlf = str_replace("\n", "\r\n", $new);
    if (str_contains($a, $oldCrlf)) {
        $a = str_replace($oldCrlf, $newCrlf, $a);
        echo "order_update role OK (crlf)\n";
    } else {
        echo "order_update NAO\n";
    }
}

$old2 = "db()->prepare('UPDATE pedidos SET status = ? WHERE id = ?')->execute([\$status, \$id]);\n            api_response(['message' => 'Status do pedido atualizado.']);";
$new2 = "db()->prepare('UPDATE pedidos SET status = ? WHERE id = ?')->execute([\$status, \$id]);\n            log_audit(\$user, 'Pedidos', 'order_update', \"Pedido #{\$id} -> status {\$status}\");\n            api_response(['message' => 'Status do pedido atualizado.']);";
if (str_contains($a, $old2)) {
    $a = str_replace($old2, $new2, $a);
    echo "audit order OK\n";
} else {
    $o2 = str_replace("\n", "\r\n", $old2);
    $n2 = str_replace("\n", "\r\n", $new2);
    if (str_contains($a, $o2)) {
        $a = str_replace($o2, $n2, $a);
        echo "audit order OK (crlf)\n";
    } else {
        echo "audit order NAO\n";
    }
}

$old4 = "db()->prepare(\"UPDATE pedidos SET {\$methodUpdate}status_pagamento = ? WHERE id = ?\")->execute(\$methodValues);\n            api_response(['message' => 'Pagamento atualizado.']);";
$new4 = "db()->prepare(\"UPDATE pedidos SET {\$methodUpdate}status_pagamento = ? WHERE id = ?\")->execute(\$methodValues);\n            log_audit(\$user, 'Pedidos/Caixa', 'payment_update', \"Pedido #{\$id} -> pagamento {\$status}\");\n            api_response(['message' => 'Pagamento atualizado.']);";
if (str_contains($a, $old4)) {
    $a = str_replace($old4, $new4, $a);
    echo "audit payment OK\n";
} else {
    $o4 = str_replace("\n", "\r\n", $old4);
    $n4 = str_replace("\n", "\r\n", $new4);
    if (str_contains($a, $o4)) {
        $a = str_replace($o4, $n4, $a);
        echo "audit payment OK (crlf)\n";
    } else {
        echo "audit payment NAO\n";
    }
}

// payment_update já foi trocado antes? verifica
if (!str_contains($a, "api_require_area('payment_status'")) {
    $old3 = "api_require_area('payments', ['administrador', 'gerente', 'colaborador', 'caixa'])";
    $new3 = "api_require_area('payment_status', ['administrador', 'gerente', 'caixa'])";
    if (str_contains($a, $old3)) {
        $a = str_replace($old3, $new3, $a);
        echo "payment area OK\n";
    } else {
        echo "payment area NAO\n";
    }
} else {
    echo "payment area já aplicado\n";
}

file_put_contents($api, $a);
