import JSZip from 'jszip';
import { Workbook } from 'exceljs';

// Exportadores como o da Kamino usam x:workbook/x:worksheet. O ExcelJS não
// reconhece esses nomes com prefixo. Normalizamos somente tags dos namespaces
// esperados na cópia em memória; textos e valores do arquivo ficam intactos.
export async function readXlsx(buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer); let changed = false;
  for (const name of Object.keys(zip.files).filter(n => /\.(xml|rels)$/.test(n))) {
    const xml = await zip.files[name].async('string');
    const prefix = /xmlns:([A-Za-z_][\w.-]*)=["']http:\/\/schemas\.openxmlformats\.org\/(?:spreadsheetml\/2006\/main|officeDocument\/2006\/extended-properties|package\/2006\/relationships)["']/.exec(xml)?.[1];
    if (!prefix) continue;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalized = xml.replace(new RegExp('(<\\/?)' + escaped + ':', 'g'), '$1');
    zip.file(name, normalized); changed = true;
  }
  const workbook = new Workbook();
  await workbook.xlsx.load(changed ? await zip.generateAsync({ type: 'arraybuffer' }) : buffer);
  return workbook;
}
