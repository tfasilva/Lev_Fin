-- Migração: ingredientes da pizza, log de auditoria e permissões granulares
-- 2026-11-18

ALTER TABLE produtos
ADD COLUMN ingredientes VARCHAR(500) NULL AFTER descricao;

CREATE TABLE IF NOT EXISTS log_alteracoes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT UNSIGNED NULL,
    usuario_nome VARCHAR(120) NOT NULL,
    tela VARCHAR(80) NOT NULL,
    funcao VARCHAR(120) NOT NULL,
    detalhe VARCHAR(500) NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;