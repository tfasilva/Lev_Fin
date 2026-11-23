<?php
// Patch helper: aplica substituições exatas em api.php / bootstrap.php
$report = [];

function patch_file(string $path, array $pairs): void
{
    $text = file_get_contents($path);
    foreach ($pairs as $needle => $replacement) {
        if (!str_contains($text, $needle)) {
            echo "NAO ENCONTRADO em $path:\n  " . substr($needle, 0, 90) . "\n";
            continue;
        }
        $text = str_replace($needle, $replacement, $text);
        echo "OK: " . substr($needle, 0, 60) . "...\n";
    }
    file_put_contents($path, $text);
}

$api = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/api.php';
$boot = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/includes/bootstrap.php';

// ---------- 1. INGREDIENTES ----------
patch_file($api, [
    // leitura de produtos inclui ingredientes
    "SELECT p.id, p.nome AS name, p.descricao AS description, p.categoria AS category, p.tipo_produto AS product_type, p.url_imagem AS image_url, p.preco AS price, p.preco AS base_price, NULL AS offer_price, p.ativo AS active, p.ordem_exibicao AS sort_order FROM produtos p"
    => "SELECT p.id, p.nome AS name, p.descricao AS description, p.ingredientes AS ingredients, p.categoria AS category, p.tipo_produto AS product_type, p.url_imagem AS image_url, p.preco AS price, p.preco AS base_price, NULL AS offer_price, p.ativo AS active, p.ordem_exibicao AS sort_order FROM produtos p",
    "SELECT p.id, p.nome AS name, p.descricao AS description, p.categoria AS category, p.tipo_produto AS product_type, p.url_imagem AS image_url, COALESCE(o.preco_oferta, p.preco) AS price, p.preco AS base_price, o.preco_oferta AS offer_price, p.ativo AS active, p.ordem_exibicao AS sort_order"
    => "SELECT p.id, p.nome AS name, p.descricao AS description, p.ingredientes AS ingredients, p.categoria AS category, p.tipo_produto AS product_type, p.url_imagem AS image_url, COALESCE(o.preco_oferta, p.preco) AS price, p.preco AS base_price, o.preco_oferta AS offer_price, p.ativo AS active, p.ordem_exibicao AS sort_order",
    // product_save: recebe ingredientes
    "\$description = trim((string) (\$input['description'] ?? ''));"
    => "\$description = trim((string) (\$input['description'] ?? ''));\n            \$ingredients = trim((string) (\$input['ingredients'] ?? ''));\n            if (mb_strlen(\$ingredients) > 500) {\n                \$fieldErrors['ingredients'] = 'Os ingredientes devem ter até 500 caracteres.';\n            }",
    "db()->prepare('UPDATE produtos SET nome = ?, descricao = ?, categoria = ?, tipo_produto = ?, url_imagem = ?, preco = ?, ativo = ? WHERE id = ?')\n                        ->execute([\$name, \$description, \$category, \$productType, \$imageUrl, \$price, !empty(\$input['active']) ? 1 : 0, \$id]);"
    => "db()->prepare('UPDATE produtos SET nome = ?, descricao = ?, ingredientes = ?, categoria = ?, tipo_produto = ?, url_imagem = ?, preco = ?, ativo = ? WHERE id = ?')\n                        ->execute([\$name, \$description, \$ingredients, \$category, \$productType, \$imageUrl, \$price, !empty(\$input['active']) ? 1 : 0, \$id]);",
    "db()->prepare('INSERT INTO produtos (nome, descricao, categoria, tipo_produto, url_imagem, preco, ativo) VALUES (?, ?, ?, ?, ?, ?, 1)')\n                        ->execute([\$name, \$description, \$category, \$productType, \$imageUrl, \$price]);"
    => "db()->prepare('INSERT INTO produtos (nome, descricao, ingredientes, categoria, tipo_produto, url_imagem, preco, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')\n                        ->execute([\$name, \$description, \$ingredients, \$category, \$productType, \$imageUrl, \$price]);",
]);

// ---------- 2. AREAS NOVAS + LOG ----------
patch_file($boot, [
    "        'orders', 'payments', 'launch_orders', 'messages', 'chat',
        'menu', 'content', 'cash', 'finance', 'reports', 'team_access',
    ];"
    => "        'orders', 'payments', 'payment_status', 'order_status', 'kitchen', 'counter', 'audit', 'launch_orders', 'messages', 'chat',
        'menu', 'content', 'cash', 'finance', 'reports', 'team_access',
    ];"
]);

echo "\nFeito.\n";
