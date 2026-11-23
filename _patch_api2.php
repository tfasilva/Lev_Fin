<?php
$api = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/api.php';
$boot = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/includes/bootstrap.php';

function patch2(string $path, array $pairs): void
{
    $text = file_get_contents($path);
    foreach ($pairs as $needle => $replacement) {
        if (!str_contains($text, $needle)) {
            echo "NAO ENCONTRADO ($path): " . substr($needle, 0, 70) . "\n";
            continue;
        }
        $text = str_replace($needle, $replacement, $text);
        echo "OK: " . substr($needle, 0, 55) . "...\n";
    }
    file_put_contents($path, $text);
}

// UPDATE/INSERT com espaçamento real do arquivo — usa regex leve
$t = file_get_contents($api);
$t = preg_replace(
    "/UPDATE produtos SET nome = \?, descricao = \?, categoria = \?/",
    'UPDATE produtos SET nome = ?, descricao = ?, ingredientes = ?, categoria = ?',
    $t
);
$t = preg_replace(
    "/execute\(\[\\\$name, \\\$description, \\\$category, \\\$productType, \\\$imageUrl, \\\$price, !empty\(\\\$input\['active'\]\) \? 1 : 0, \\\$id\]\);/",
    'execute([$name, $description, $ingredients, $category, $productType, $imageUrl, $price, !empty($input[\'active\']) ? 1 : 0, $id]);',
    $t,
    1
);
$t = preg_replace(
    "/INSERT INTO produtos \(nome, descricao, categoria, tipo_produto, url_imagem, preco, ativo\) VALUES \(\?, \?, \?, \?, \?, \?, 1\)/",
    'INSERT INTO produtos (nome, descricao, ingredientes, categoria, tipo_produto, url_imagem, preco, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
    $t
);
$t = preg_replace(
    "/execute\(\[\\\$name, \\\$description, \\\$category, \\\$productType, \\\$imageUrl, \\\$price\]\);/",
    'execute([$name, $description, $ingredients, $category, $productType, $imageUrl, $price]);',
    $t,
    1
);
file_put_contents($api, $t);
echo "api ingredient writes done\n";

$b = file_get_contents($boot);
$old = "'orders', 'payments', 'launch_orders', 'messages', 'chat',";
$new = "'orders', 'payments', 'payment_status', 'order_status', 'kitchen', 'counter', 'audit', 'launch_orders', 'messages', 'chat',";
if (str_contains($b, $old)) {
    $b = str_replace($old, $new, $b);
    echo "areas OK\n";
} else {
    echo "areas NAO\n";
}
file_put_contents($boot, $b);
