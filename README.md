# LevFin com XAMPP ou GitHub Pages

A página pode funcionar de duas formas:

- **GitHub Pages:** use o armazenamento local do navegador (IndexedDB), sem servidor.
- **XAMPP:** use PHP + MariaDB/MySQL para compartilhar os levantamentos no servidor local.

No modo local, os dados ficam neste navegador e dispositivo. Para não perder informações ao trocar de computador ou limpar os dados do site, use regularmente os botões **Baixar Backup JSON** e **Restaurar Backup JSON**.

## Requisitos

- XAMPP com Apache e MySQL/MariaDB ativos (Apache na porta 80 e MySQL na 3306)
- PHP com `PDO` e `pdo_mysql` habilitados

## Uso no GitHub Pages

Publique `index.html`, `app.js`, `styles.css` e `por.traineddata` no GitHub Pages. Na aplicação, abra as configurações de armazenamento e selecione **Somente Neste Navegador (Offline / Sem banco)**.

O GitHub Pages não executa PHP nem fornece MySQL. Portanto, os arquivos `api.php`, `schema.sql` e `deploy-xampp.ps1` não são necessários para o modo local e o servidor MySQL não será acessível automaticamente por outros computadores.

## Configuração local com XAMPP

O banco `levfin`, as tabelas `reports` e `settings`, o usuário `levfin_app` e o `.env` são usados pelo MySQL local do XAMPP. A senha do usuário deve permanecer no `.env`, fora da pasta pública do Apache.

O ponto de entrada Apache em `C:\xampp\htdocs\levfin-api.php` carrega a API em `C:\xampp\levfin\api.php`. A pasta `C:\xampp\levfin` fica fora da raiz pública do Apache e contém o `.env` privado.

Abra `index.html` com o Live Server do VS Code (`http://127.0.0.1:5500`). A página envia as chamadas à API PHP do Apache em `http://127.0.0.1/levfin-api.php`. Para validar a conexão, acesse essa URL com `?path=%2Fhealth`; a resposta esperada é `{"ok":true,"database":"mysql"}`.

Se atualizar `api.php` ou `.env` no projeto, execute `deploy-xampp.ps1` para copiar as versões atuais para a pasta privada do XAMPP e atualizar o ponto de entrada.

O reconhecimento de texto usa o arquivo local `por.traineddata`, que deve permanecer na mesma pasta de `index.html`. A leitura faz uma segunda tentativa quando faltam campos. A biblioteca principal do OCR ainda vem da CDN, portanto é necessária conexão com a internet.

## Segurança

O usuário MySQL `levfin_app` tem somente permissões de leitura e gravação no banco `levfin`. A API aceita chamadas do Live Server local configuradas em `WEB_ORIGIN`. Para acesso pela rede, defina `API_TOKEN` com pelo menos 24 caracteres, ajuste `WEB_ORIGIN` e proteja o Apache com HTTPS e firewall. Nunca publique `.env` ou tokens no GitHub Pages.
