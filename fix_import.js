const fs = require('fs');
const path = 'g:\\Meu Drive\\Projetos TADS\\Lev_Fin\\app.js';

let content = fs.readFileSync(path, 'utf-8');

// O bloco atual (linhas 926-936) está quebrado: as options e fechamento estão fora da condição
const old = `              \${!hidesRemittance ? \`<div>\` : \`\`}
              \${!hidesRemittance ? \`
                <label>M\u00e9todo no Banco</label>
                <select data-import-field="remittanceType" class="\${row.remittanceType ? "" : "ocr-field-missing"}">\` : \`\`}
                  <option value=""\${!row.remittanceType ? " selected" : ""}>\u26a0\ufe0f Selecione o m\u00e9todo</option>
                  <option value="standard"\${row.remittanceType === "standard" ? " selected" : ""}>✉️ Remessa</option>
                  <option value="pix"\${row.remittanceType === "pix" ? " selected" : ""}>✉️ Remessa_PIX</option>
                  <option value="manual"\${row.remittanceType === "manual" ? " selected" : ""}>📝 Lançamento Manual</option>
                  <option value="gestao"\${row.remittanceType === "gestao" ? " selected" : ""}>📝 Lançamento Gestão</option>
                </select>
              </div>`;

const newBlock = `              \${!hidesRemittance ? \`
              <div>
                <label>M\u00e9todo no Banco</label>
                <select data-import-field="remittanceType" class="\${row.remittanceType ? "" : "ocr-field-missing"}">
                  <option value=""\${!row.remittanceType ? " selected" : ""}>\u26a0\ufe0f Selecione o m\u00e9todo</option>
                  <option value="standard"\${row.remittanceType === "standard" ? " selected" : ""}>✉️ Remessa</option>
                  <option value="pix"\${row.remittanceType === "pix" ? " selected" : ""}>✉️ Remessa_PIX</option>
                  <option value="manual"\${row.remittanceType === "manual" ? " selected" : ""}>📝 Lançamento Manual</option>
                  <option value="gestao"\${row.remittanceType === "gestao" ? " selected" : ""}>📝 Lançamento Gestão</option>
                </select>
              </div>
              : ''\}`;

if (content.includes(old)) {
  content = content.replace(old, newBlock);
  fs.writeFileSync(path, content, 'utf-8');
  console.log('SUCESSO: Bloco substituído');
} else {
  console.log('FALHA: Bloco não encontrado');
  // Debug
  const lines = content.split('\\n');
  for (let i = 925; i < 937; i++) {
    console.log(`Linha ${i + 1}: ${JSON.stringify(lines[i])}`);
  }
}