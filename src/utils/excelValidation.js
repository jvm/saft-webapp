import * as XLSX from 'xlsx';
import { validateSignatureChain } from './signatureChain.js';

// Transform DOCUMENT_NUMBER to InvoiceNo as specified
function formatInvoiceNo(docNumber) {
  if (!docNumber) return '';
  const prefix = 'FS ';
  // Insert '/' after 11th character
  const main = docNumber.slice(0, 11) + '/' + docNumber.slice(11);
  let result = prefix + main;
  // Ensure length is exactly 22 characters (pad or trim if needed)
  if (result.length > 22) result = result.slice(0, 22);
  if (result.length < 22) result = result.padEnd(22, ' ');
  return result;
}

// Extract rows and map to validation fields
export async function extractExcelDocuments(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

  return rows.map(row => {
    // Parse EMISSION_DATE for both fields
    let raw = row['EMISSION_DATE'] || '';
    let datePart = '';
    let dateTimePart = '';
    if (raw.includes('T')) {
      [datePart, dateTimePart] = raw.split('T');
      dateTimePart = dateTimePart.split('.')[0]; // Remove ms if present
    } else if (raw.includes(' ')) {
      [datePart, dateTimePart] = raw.split(' ');
    } else {
      datePart = raw;
      dateTimePart = '';
    }
    // InvoiceDate: only date
    const InvoiceDate = datePart;
    // SystemEntryDate: full datetime (YYYY-MM-DDTHH:MM:SS)
    let SystemEntryDate = '';
    if (datePart && dateTimePart) {
      SystemEntryDate = `${datePart}T${dateTimePart.slice(0,8)}`;
    } else if (datePart) {
      SystemEntryDate = `${datePart}T00:00:00`;
    }
    // Convert GrossTotal from cents to euros
    const grossTotalEuros = row['LANE_OPERATOR_PRICE'] ? (parseFloat(row['LANE_OPERATOR_PRICE']) / 100).toString() : '';
    return {
      InvoiceNo: formatInvoiceNo(row['DOCUMENT_NUMBER']),
      InvoiceDate,
      SystemEntryDate,
      GrossTotal: grossTotalEuros,
      Hash: row['SIGNATURE'],
    };
  });
}

// Sequentiality and signature chain validation for Excel docs
export async function validateExcelDocuments(docs, publicKeyPem) {
  // Prepare stats
  let processed = 0;
  let validCount = 0;
  let sequenceFails = 0;
  let signatureFails = 0;
  let failedDocs = [];
  let seriesSet = new Set();
  // Sequentiality and signature chain state
  let lastNumbers = {};
  let prevHashes = {};
  let cryptoKey = null;
  if (publicKeyPem) {
    try {
      const pem = publicKeyPem.replace('-----BEGIN PUBLIC KEY-----', '').replace('-----END PUBLIC KEY-----', '').replace(/\s+/g, '');
      cryptoKey = await window.crypto.subtle.importKey(
        'spki',
        Uint8Array.from(atob(pem), c => c.charCodeAt(0)).buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-1' } },
        false,
        ['verify']
      );
    } catch (e) {
      return { status: 'NOK', message: 'Failed to import public key: ' + e.message };
    }
  }
  for (let i = 0; i < docs.length; i++) {
    processed++;
    const { InvoiceNo, InvoiceDate, SystemEntryDate, GrossTotal, Hash } = docs[i];
    const match = InvoiceNo.match(/^(.+)\/(\d+)$/);
    if (!match) continue;
    const prefix = match[1];
    const number = parseInt(match[2], 10);
    seriesSet.add(prefix);
    // Sequentiality check
    let seqFail = false;
    if (lastNumbers[prefix] !== undefined) {
      if (number !== lastNumbers[prefix] + 1) {
        sequenceFails++;
        seqFail = true;
        failedDocs.push({
          row: i + 1,
          InvoiceNo,
          type: 'sequence',
          message: `Non-sequential InvoiceNo in prefix series '${prefix}': ${lastNumbers[prefix]} followed by ${number}`
        });
      }
    }
    lastNumbers[prefix] = number;
    // Signature chain check (skip first doc of series)
    let sigFail = false;
    if (cryptoKey && prevHashes[prefix]) {
      const grossTotalFormatted = parseFloat(GrossTotal).toFixed(2);
      const dataToVerify = [InvoiceDate, SystemEntryDate, InvoiceNo, grossTotalFormatted, prevHashes[prefix]].join(';');
      const signature = Uint8Array.from(atob(Hash), c => c.charCodeAt(0));
      const encoder = new TextEncoder();
      const data = encoder.encode(dataToVerify);
      try {
        const valid = await window.crypto.subtle.verify(
          { name: 'RSASSA-PKCS1-v1_5' },
          cryptoKey,
          signature,
          data
        );
        if (!valid) {
          signatureFails++;
          sigFail = true;
          failedDocs.push({
            row: i + 1,
            InvoiceNo,
            type: 'signature',
            message: `Signature verification failed. String: '${dataToVerify}'. Hash: '${Hash}'`
          });
        }
      } catch (e) {
        signatureFails++;
        sigFail = true;
        failedDocs.push({
          row: i + 1,
          InvoiceNo,
          type: 'signature',
          message: `Signature verification error: ${e.message}`
        });
      }
    }
    prevHashes[prefix] = Hash;
    if (!seqFail && !sigFail) validCount++;
  }
  const status = (sequenceFails === 0 && signatureFails === 0) ? 'OK' : 'NOK';
  return {
    status,
    processed,
    seriesCount: seriesSet.size,
    validCount,
    sequenceFails,
    signatureFails,
    failedDocs,
    message: status === 'OK' ? 'All documents are valid.' : 'Some documents failed validation.'
  };
}

