import fs from 'fs';

const path = 'g:\\Meu Drive\\Projetos TADS\\Lev_Fin\\app.js';
let content = fs.readFileSync(path, 'utf-8');
const lines = content.split('\n');

console.log('Total de linhas:', lines.length);

// Construir o novo bloco para linhas 926-936
const newBlock = [
  '              ${!hidesRemittance ? `',
  '              <div>',
  '                <label>M\u00e9todo no Banco</label>',
  '                <select data-import-field="remittanceType" class="${row.remittanceType ? "" : "ocr-field-missing"}">',
  '                  <option value=""${!row.remittanceType ? " selected" : ""}>\u26a0\ufe0f Selecione o m\u00e9todo</option>',
  '                  <option value="standard"${row.remittanceType === "standard" ? " selected" : ""}>✉️ Remessa</option>',
  '                  <option value="pix"${row.remittanceType === "pix" ? " selected" : ""}>✉️ Remessa_PIX</option>',
  '                  <option value="manual"${row.remittanceType === "manual" ? " selected" : ""}>📝 Lançamento Manual</option>',
  '                  <option value="gestao"${row.remittanceType === "gestao" ? " selected" : ""}>📝 Lançamento Gestão</option>',
  '                </select>',
  '              </div>',
  '              : ``}',
];

const newLines = [
  ...lines.slice(0, 925),
  newBlock.join('\n'),
  ...lines.slice(936),
];

fs.writeFileSync(path, newLines.join('\n'), 'utf-8');
console.log('SUCESSO: Bloco substituído');