<?php
// Adiciona cases cozinha/balcao no dispatcher + funções das telas + link no adminNav
$f = 'G:/Meu Drive/Projetos TADS/WebPizzariaV2/assets/site.js';
$t = file_get_contents($f);

// 1. dispatcher cases
$anchor = "case 'painel':";
if (!str_contains($t, $anchor)) {
  echo "dispatch NAO\n";
  exit(1);
}
$add = "case 'cozinha': kitchenPage(); break;\n      case 'balcao': counterPage(); break;\n      ";
$t = str_replace($anchor, $add . $anchor, $t);
echo "cases OK\n";

// 2. funções das telas (insere antes de "async function ordersPage()")
$kitchen = <<< 'JS'
  async function kitchenPage() {
    const result = await api('orders');
    const active = result.orders.filter((o) => ['recebido', 'preparando'].includes(o.status));
    const cards = active.map((order) => {
      const id = Number(order.id);
      const pizzas = (order.items || []).filter((item) => (item.name || '').toLowerCase().includes('pizza') || item.image_url);
      const firstImage = pizzas.find((item) => item.image_url)?.image_url || '';
      const itemsHtml = (order.items || []).map((item) => `<li><strong>${Number(item.quantity)}×</strong> ${escapeHtml(item.product_name)}</li>`).join('');
      return `<article class="kitchen-card" data-order-id="${id}">
        <div class="kitchen-photo">${firstImage ? `<img src="${escapeHtml(firstImage)}" alt="">` : '<span class="kitchen-noimg">🍕</span>'}</div>
        <div class="kitchen-info">
          <header><span class="order-number">PEDIDO #${id}</span><span class="status-pill status-${escapeHtml(order.status)}">${escapeHtml(orderStatusLabel(order.status))}</span></header>
          <time>${escapeHtml(dateTimeLabel(order.created_at))}</time>
          <ul>${itemsHtml}</ul>
          ${order.notes ? `<p class="kitchen-notes">Obs.: ${escapeHtml(order.notes)}</p>` : ''}
          <div class="kitchen-actions">
            <select aria-label="Status do pedido" data-order-status="${id}">${Object.entries(orderStatusLabels).map(([status, label]) => `<option value="${status}" ${status === order.status ? 'selected' : ''}>${label}</option>`).join('')}</select>
            <button class="button button-small button-dark" data-save-order="${id}">Atualizar</button>
          </div>
        </div>
      </article>`;
    }).join('');
    main.innerHTML = `<div class="admin-layout"><aside class="admin-sidebar">${adminNav()}<div class="sidebar-note">Produção</div></aside><section class="admin-content"><div class="page-heading"><div><p class="eyebrow">COZINHA</p><h1>Pedidos em produção</h1><p>Pedidos recebidos e em preparo, em destaque visual.</p></div></div><div class="kitchen-grid">${cards || '<p class="empty-state">Nenhum pedido em produção agora.</p>'}</div></section></div>`;
    bindOrderControls();
  }
  async function counterPage() {
    const result = await api('orders');
    const flow = [['recebido', 'Recebido'], ['preparando', 'Em preparo'], ['saiu_para_entrega', 'Saiu para entrega'], ['entregue', 'Entregue']];
    const columns = flow.map(([status, label]) => {
      const matching = result.orders.filter((o) => o.status === status && o.status !== 'cancelado');
      const cards = matching.map((order) => `<article class="counter-card status-${escapeHtml(order.status)}"><span class="order-number">PEDIDO #${Number(order.id)}</span><strong>${escapeHtml(order.customer_name)}</strong><span class="counter-items">${(order.items || []).map((item) => `${Number(item.quantity)}× ${escapeHtml(item.product_name)}`).join('<br>')}</span><span class="status-pill status-${escapeHtml(order.status)}">${escapeHtml(orderStatusLabel(order.status))}</span></article>`).join('');
      return `<div class="counter-column"><h2>${label} <small>(${matching.length})</small></h2>${cards || '<p class="empty-state">—</p>'}</div>`;
    }).join('');
    main.innerHTML = `<div class="admin-layout"><aside class="admin-sidebar">${adminNav()}<div class="sidebar-note">Balcão</div></aside><section class="admin-content"><div class="page-heading"><div><p class="eyebrow">BALCÃO</p><h1>Andamento dos pedidos</h1><p>Acompanhe o status de cada pedido em tempo real.</p></div></div><div class="counter-board">${columns}</div></section></div>`;
  }
  function bindOrderControls() {
    main.querySelectorAll('[data-save-order]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.saveOrder;
        const select = main.querySelector(`[data-order-status="${id}"]`);
        await api('', { action: 'order_update', id, status: select.value });
        notify('Status atualizado.');
      });
    });
  }

JS;
$anchor2 = '  async function ordersPage()';
if (!str_contains($t, $anchor2)) {
  echo "anchor2 NAO\n";
  exit(1);
}
$t = str_replace($anchor2, $kitchen . $anchor2, $t);
echo "telas OK\n";

// 3. Links no adminNav
$oldNav = "      hasArea('orders') ? '<a href=\"painel.html\">◷ Pedidos</a>' : '',";
$newNav = "      hasArea('orders') ? '<a href=\"painel.html\">◷ Pedidos</a>' : '',\n      hasArea('kitchen') ? '<a href=\"cozinha.html\">🔥 Cozinha</a>' : '',\n      hasArea('counter') ? '<a href=\"balcao.html\">🎺 Balcão</a>' : '',";
if (str_contains($t, $oldNav)) {
  $t = str_replace($oldNav, $newNav, $t);
  echo "nav OK\n";
} else echo "nav NAO\n";

file_put_contents($f, $t);
