import { FIELDS, type CommentRecord } from './types';
self.onmessage = async (event:MessageEvent<{records:CommentRecord[];format:'json'|'csv'|'xlsx'}>) => {
  try {
    const {records,format}=event.data;
    const rows=records.map(record=>Object.fromEntries(FIELDS.map(key=>[key,record[key]])));
    let blob:Blob;
    if(format==='json') blob=new Blob([JSON.stringify(rows,null,2)],{type:'application/json;charset=utf-8'});
    else if(format==='csv') {
      // CSV can be opened by spreadsheet software: neutralize formula prefixes.
      const cell=(value:unknown)=>{let s=String(value??'');if(/^[\t\r\n ]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
      blob=new Blob(['\ufeff',FIELDS.join(','),'\r\n',rows.map(row=>FIELDS.map(key=>cell(row[key])).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    } else {
      const ExcelJS=await import('exceljs');const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Comments');
      sheet.addRow(FIELDS);for(const row of rows)sheet.addRow(FIELDS.map(key=>row[key]));
      blob=new Blob([await workbook.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    }
    self.postMessage({blob});
  } catch {self.postMessage({error:true});}
};
