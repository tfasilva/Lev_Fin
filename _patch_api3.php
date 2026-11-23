<?php
$api = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/api.php';
$boot = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/includes/bootstrap.php';
$q = "'";

function patch3(string $path, array $pairs): void
{
    $text = file_get_contents($path);
    foreach ($pairs as $needle => $replacement) {
        if (!str_contains($text, $needle)) {
            echo "NAO ($path): " . substr($needle, 0, 60) . "\n";
            continue;
        }
        $text = str_replace($needle, $replacement, $text);
        echo "OK: " . substr($needle, 0, 50) . "...\n";
    }
    file_put_contents($path, $text);
}

// ====== helper log_audit em bootstrap.php ======
$b = file_get_contents($boot);
$anchor = "function user_has_access(array \$user, string \$area): bool";
$logFn = <<<'PHP'
function log_audit(?array $user, string $tela, string $funcao, string $detalhe = ''): void
{
    try {
        db()->prepare('INSERT INTO log_alteracoes (usuario_id, usuario_nome, tela, funcao, detalhe) VALUES (?, ?, ?, ?, ?)')
            ->execute([
                $user['id'] ?? null,
                $user['name'] ?? 'sistema',
                mb_substr($tela, 0, 80),
                mb_substr($funcao, 0, 120),
                mb_substr($detalhe, 0, 500),
            ]);
    } catch (Throwable $e) {
        // auditoria não deve derrubar a operação principal
    }
}

PHP;
if (!str_contains($b, 'function log_audit')) {
    if (!str_contains($b, $anchor)) {
        echo "anchor audit NAO\n";
        exit(1);
    }
    $b = str_replace($anchor, $logFn . $anchor, $b);
    file_put_contents($boot, $b);
    echo "log_audit OK\n";
}

// ====== api.php: restrito + audit ======
$a = file_get_contents($api);

// order_update: só administrador/gerente/colaborador (balcão/cozinha) com area order_status
$old = "case 'order_update':\n            api_require_area('orders', ['administrador', 'gerente', 'colaborador', 'caixa']);";
$new = "case 'order_update':\n            \$user = api_require_area('order_status', ['administrador', 'gerente', 'colaborador']);";
if (!str_contains($a, $old)) {
    echo "order_update NAO\n";
    exit(1);
}
$a = str_replace($old, $new, $a);
$old2 = "db()->prepare('UPDATE pedidos SET status = ? WHERE id = ?')->execute([\$status, \$id]);\n            api_response(['message' => 'Status do pedido atualizado.']);";
$new2 = "db()->prepare('UPDATE pedidos SET status = ? WHERE id = ?')->execute([\$status, \$id]);\n            log_audit(\$user, 'Pedidos', 'order_update', \"Pedido #{\$id} -> status {\$status}\");\n            api_response(['message' => 'Status do pedido atualizado.']);";
if (!str_contains($a, $old2)) {
    echo "order_update2 NAO\n";
    exit(1);
}
$a = str_replace($old2, $new2, $a);

// payment_update: só administrador, gerente e caixa; colaborador continua via solicitação
$old3 = "case 'payment_update':\n            \$user = api_require_area('payments', ['administrador', 'gerente', 'colaborador', 'caixa']);";
$new3 = "case 'payment_update':\n            \$user = api_require_area('payment_status', ['administrador', 'gerente', 'caixa']);";
if (!str_contains($a, $old3)) {
    echo "payment_update NAO\n";
    exit(1);
}
$a = str_replace($old3, $new3, $a);
$old4 = "db()->prepare(\"UPDATE pedidos SET {\$methodUpdate}status_pagamento = ? WHERE id = ?\")->execute(\$methodValues);\n            api_response(['message' => 'Pagamento atualizado.']);";
$new4 = "db()->prepare(\"UPDATE pedidos SET {\$methodUpdate}status_pagamento = ? WHERE id = ?\")->execute(\$methodValues);\n            log_audit(\$user, 'Pedidos/Caixa', 'payment_update', \"Pedido #{\$id} -> pagamento {\$status}\");\n            api_response(['message' => 'Pagamento atualizado.']);";
if (!str_contains($a, $old4)) {
    echo "payment_update2 NAO\n";
    exit(1);
}
$a = str_replace($old4, $new4, $a);

file_put_contents($api, $a);
echo "api permissoes OK\n";
