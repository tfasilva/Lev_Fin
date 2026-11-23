<?php
// Auditoria: página no dispatcher + função auditPage() e link no nav (somente admin)
$f = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/assets/site.js';
$t = file_get_contents($f);

$old = "'painel.html':'painel','cozinha.html':'cozinha','balcao.html':'balcao'";
if (!str_contains($t, $old)) {
  echo "map NAO\n";
  exit(1);
}
$t = str_replace($old, $old . ",'auditoria.html':'audit'", $t);

$anchor = "case 'painel':";
$add = "case 'audit': auditPage(); break;\n      ";
$t = str_replace($anchor, $add . $anchor, $t);

$fn = <<< 'JS'
  async function auditPage() {
    if (user?.role !== 'administrador') { renderAccessDenied(); return; }
    const result = await api('audit');
    const rows = (result.log || []).map((row) => `<tr><td>${escapeHtml(dateTimeLabel(row.criado_em))}</td><td>${escapeHtml(row.usuario_nome)}</td><td>${escapeHtml(row.tela)}</td><td>${escapeHtml(row.funcao)}</td><td>${escapeHtml(row.detalhe || '')}</td></tr>`).join('');
    main.innerHTML = `<div class="admin-layout"><aside class="admin-sidebar">${adminNav()}<div class="sidebar-note">Governança</div></aside><section class="admin-content"><div class="page-heading"><div><p class="eyebrow">SEGURANÇA</p><h1>Relatório de alterações</h1><p>Toda mudança relevante registrada com autor, tela, função e horário.</p></div></div><div class="table-wrap"><table><thead><tr><th>Quando</th><th>Quem</th><th>Tela</th><th>Função</th><th>Detalhe</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Nenhuma alteração registrada ainda.</td></tr>'}</tbody></table></div></section></div>`;
  }

JS;
$anchor2 = '  async function ordersPage()';
$t = str_replace($anchor2, $fn . $anchor2, $t);

$navOld = "      hasArea('team_access') ? `<a href=\"usuarios.html\">♙";
$navNew = "      hasArea('audit') ? '<a href=\"auditoria.html\">⟳ Alterações</a>' : '',\n" . $navOld;
$t = str_replace($navOld, $navNew, $t);

file_put_contents($f, $t);
echo "audit page OK\n";
