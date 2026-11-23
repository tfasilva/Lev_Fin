<?php
// Itens do pedido agora incluem imagem e descrição do produto
$api = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/api.php';
$a = file_get_contents($api);
$old = "SELECT nome_produto AS product_name, quantidade AS quantity, preco_unitario AS unit_price FROM itens_pedido WHERE pedido_id = ? ORDER BY id";
$new = "SELECT ip.nome_produto AS product_name, ip.quantidade AS quantity, ip.preco_unitario AS unit_price, p.url_imagem AS image_url, p.descricao AS description, p.ingredientes AS ingredients
                    FROM itens_pedido ip
                    LEFT JOIN produtos p ON p.id = ip.produto_id
                    WHERE ip.pedido_id = ? ORDER BY ip.id";
if (str_contains($a, $old)) {
    $a = str_replace($old, $new, $a);
    echo "items OK\n";
} else echo "items NAO\n";
file_put_contents($api, $a);

// Cozinha: mostra ingredientes/descrição e imagem real do primeiro item com foto
$f = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/assets/site.js';
$t = file_get_contents($f);

$oldItems = "const itemsHtml = (order.items || []).map((item) => `<li><strong>\${Number(item.quantity)}×</strong> \${escapeHtml(item.product_name)}</li>`).join('');";
$newItems = "const itemsHtml = (order.items || []).map((item) => `<li><strong>\${Number(item.quantity)}×</strong> \${escapeHtml(item.product_name)}\${item.ingredients ? `<small class=\"kitchen-ing\"> — \${escapeHtml(item.ingredients)}</small>` : item.description ? `<small class=\"kitchen-ing\"> — \${escapeHtml(item.description)}</small>` : ''}</li>`).join('');";
if (str_contains($t, $oldItems)) {
    $t = str_replace($oldItems, $newItems, $t);
    echo "kitchen items OK\n";
} else echo "kitchen items NAO\n";

$oldImg = "const firstImage = pizzas.find((item) => item.image_url)?.image_url || '';";
$newImg = "const firstImage = (order.items || []).find((item) => item.image_url)?.image_url || '';";
if (str_contains($t, $oldImg)) {
    $t = str_replace($oldImg, $newImg, $t);
    echo "img fix OK\n";
} else echo "img NAO\n";

$oldPiz = "const pizzas = (order.items || []).filter((item) => (item.name || '').toLowerCase().includes('pizza') || item.image_url);";
$newPiz = "";
if (str_contains($t, $oldPiz)) {
    $t = str_replace($oldPiz, $newPiz, $t);
    echo "pizzas var removida\n";
}

file_put_contents($f, $t);
