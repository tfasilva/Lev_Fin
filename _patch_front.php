<?php
// Frontend: campo de ingredientes no form do admin + exibição no cardápio + tela audit
$f = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/assets/site.js';
$t = file_get_contents($f);

// 1. Campo ingredientes após Descrição no form admin
$old = '<label class="field-wide">Descrição<textarea name="description" required maxlength="1000">${escapeHtml(item?.description || \'\')}</textarea></label>';
$new = '<label class="field-wide">Descrição<textarea name="description" required maxlength="1000">${escapeHtml(item?.description || \'\')}</textarea></label><label class="field-wide">Ingredientes (exibidos no cardápio)<input name="ingredients" maxlength="500" value="${escapeHtml(item?.ingredients || \'\')}" placeholder="Molho, mussarela, manjericão..."></label>';
if (str_contains($t, $old)) {
    $t = str_replace($old, $new, $t);
    echo "form ingredientes OK\n";
} else echo "form NAO\n";

// 2. Preencher ingredientes ao abrir edição: localizar montagem do item do admin
// (procura onde o dialog de edição é montado e passa item.ingredients — geralmente item vem do próprio objeto, então nada a fazer)

// 3. Exibir ingredientes na pizza do cardápio: encontrar render do card da pizza
$needle3 = 'product.description';
echo "desc refs: " . substr_count($t, $needle3) . "\n";

file_put_contents($f, $t);
