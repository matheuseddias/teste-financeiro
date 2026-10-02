export interface Sheet { name: string; rows: unknown[][] }
export function csvRows(text: string): string[][] {
  const first = text.split(/\r?\n/)[0]; const separator = (first.match(/;/g)?.length || 0) >= (first.match(/,/g)?.length || 0) ? ';' : ',';
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === separator && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('CSV com aspas sem fechamento.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export async function readSheets(file: File): Promise<Sheet[]> {
  if (file.size > 8 * 1024 * 1024) throw new Error('Use arquivos de até 8 MB e 2000 movimentos por importação.');
  const buffer = await file.arrayBuffer(); const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const { readXlsx } = await import('./readXlsx'); const workbook = await readXlsx(buffer);
    return workbook.worksheets.map(sheet => {
      if (sheet.rowCount > 20000 || sheet.columnCount > 200) throw new Error('Planilha muito grande. Exporte somente o período e a conta desejados.');
      const rows: unknown[][] = [];
      sheet.eachRow({ includeEmpty: true }, row => {
        const cells: unknown[] = [];
        for (let col = 1; col <= sheet.columnCount; col++) {
          const v = row.getCell(col).value;
          cells.push(v && typeof v === 'object' && !(v instanceof Date) ? 'result' in v ? v.result ?? '' : 'richText' in v ? v.richText.map(t => t.text).join('') : 'text' in v ? v.text : '' : v);
        }
        rows.push(cells);
      });
      return { name: sheet.name, rows };
    });
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('Este arquivo é XLS antigo. Salve como XLSX ou CSV antes de importar.');
  let text = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
  if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(buffer);
  if (/<table[\s>]/i.test(text)) {
    const template = document.createElement('template'); template.innerHTML = text;
    const tables = [...template.content.querySelectorAll('table')];
    return tables.map((table, i) => ({ name: 'Tabela ' + (i + 1), rows: [...table.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent?.trim() || '')) }));
  }
  const rows = csvRows(text); if (rows.length > 20000) throw new Error('Arquivo com linhas demais. Separe por conta e período.');
  return [{ name: file.name, rows }];
}
