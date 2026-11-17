import re
from pathlib import Path

path = Path(r"g:\Meu Drive\Projetos TADS\Lev_Fin\app.js")
content = path.read_text(encoding="utf-8")

# ============================================================
# 1. TELA DE IMPORTAÇÃO: não solicitar remessa quando pago/autorizado
# ============================================================
old1 = '''          const isDateHidden = !row.remittanceType || row.remittanceType === "manual" || row.remittanceType === "gestao";'''
new1 = '''          const hidesRemittance = row.status === "authorized" || row.status === "paid";
          const isDateHidden = hidesRemittance || !row.remittanceType || row.remittanceType === "manual" || row.remittanceType === "gestao";'''
if old1 in content:
    content = content.replace(old1, new1)
    print("OK 1: hidesRemittance adicionado na importação")
else:
    print("FALHA 1: bloco não encontrado")

# Envolver bloco do Método no Banco em condição
old_method_block = '''              <div>
                <label>Método no Banco</label>
                <select data-import-field="remittanceType" class="${row.remittanceType ? "" : "ocr-field-missing"}">
                  <option value=""${!row.remittanceType ? " selected" : ""}>⚠️ Selecione o método</option>
                  <option value="standard"${row.remittanceType === "standard" ? " selected" : ""}>✉️ Remessa</option>
                  <option value="pix"${row.remittanceType === "pix" ? " selected" : ""}>✉️ Remessa_PIX</option>
                  <option value="manual"${row.remittanceType === "manual" ? " selected" : ""}>📝 Lançamento Manual</option>
                  <option value="gestao"${row.remittanceType === "gestao" ? " selected" : ""}>📝 Lançamento Gestão</option>
                </select>
              </div>'''

new_method_block = '''              ${remittanceMethodHtml}'''

if old_method_block in content:
    content = content.replace(old_method_block, new_method_block)
    print("OK 2: Bloco Método no Banco envolvido em condição")
else:
    print("FALHA 2: bloco Método no Banco não encontrado")

# Adicionar variável remittanceMethodHtml antes do return
old_return_start = '''          const isDateHidden = hidesRemittance || !row.remittanceType || row.remittanceType === "manual" || row.remittanceType === "gestao";
          return `<article class="import-row"'''
new_return_start = '''          const isDateHidden = hidesRemittance || !row.remittanceType || row.remittanceType === "manual" || row.remittanceType === "gestao";
          const remittanceMethodHtml = hidesRemittance ? "" : \`
              <div>
                <label>Método no Banco</label>
                <select data-import-field="remittanceType" class="${row.remittanceType ? "" : "ocr-field-missing"}">
                  <option value=""${!row.remittanceType ? " selected" : ""}>⚠️ Selecione o método</option>
                  <option value="standard"${row.remittanceType === "standard" ? " selected" : ""}>✉️ Remessa</option>
                  <option value="pix"${row.remittanceType === "pix" ? " selected" : ""}>✉️ Remessa_PIX</option>
                  <option value="manual"${row.remittanceType === "manual" ? " selected" : ""}>📝 Lançamento Manual</option>
                  <option value="gestao"${row.remittanceType === "gestao" ? " selected" : ""}>📝 Lançamento Gestão</option>
                </select>
              </div>\`;
          return `<article class="import-row"'''

if old_return_start in content:
    content = content.replace(old_return_start, new_return_start)
    print("OK 3: Variável remittanceMethodHtml adicionada")
else:
    print("FALHA 3: return start não encontrado")

path.write_text(content, encoding="utf-8")
print("Todas as alterações da importação aplicadas!")