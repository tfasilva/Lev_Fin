# LevFin com XAMPP

A página usa PHP no Apache do XAMPP para acessar o MariaDB/MySQL. As credenciais ficam em `.env`, fora da pasta pública do Apache.

## Requisitos

- XAMPP com Apache e MySQL/MariaDB ativos (Apache na porta 80 e MySQL na 3306)
- PHP com `PDO` e `pdo_mysql` habilitados

## Configuração local

O banco `levfin`, as tabelas `reports` e `settings`, o usuário `levfin_app` e o `.env` já foram preparados nesta máquina usando o MySQL local do XAMPP. A senha aleatória do usuário foi gravada no `.env` e copiada para `C:\xampp\levfin\.env`; ela não é necessária na página.

O ponto de entrada Apache em `C:\xampp\htdocs\levfin-api.php` carrega a API em `C:\xampp\levfin\api.php`. A pasta `C:\xampp\levfin` fica fora da raiz pública do Apache e contém o `.env` privado.

Abra `index.html` com o Live Server do VS Code (`http://127.0.0.1:5500`). A página envia as chamadas à API PHP do Apache em `http://127.0.0.1/levfin-api.php`. Para validar a conexão, acesse essa URL com `?path=%2Fhealth`; a resposta esperada é `{"ok":true,"database":"mysql"}`.

Se atualizar `api.php` ou `.env` no projeto, execute `deploy-xampp.ps1` para copiar as versões atuais para a pasta privada do XAMPP e atualizar o ponto de entrada.

O reconhecimento de texto usa o arquivo local `por.traineddata`, que deve permanecer na mesma pasta de `index.html`. A leitura faz uma segunda tentativa quando faltam campos. A biblioteca principal do OCR ainda vem da CDN, portanto e necessaria conexao com a internet.

## Segurança

O usuário MySQL `levfin_app` tem somente permissões de leitura e gravação no banco `levfin`. A API aceita chamadas do Live Server local configuradas em `WEB_ORIGIN`. Para acesso pela rede, defina `API_TOKEN` com pelo menos 24 caracteres, ajuste `WEB_ORIGIN` e proteja o Apache com HTTPS e firewall.
